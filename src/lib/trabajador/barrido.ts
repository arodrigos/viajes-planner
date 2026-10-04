import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverNombre } from "@/lib/lugares/resolverPlan";
import { resolverFoto } from "@/lib/lugares/resolverFotos";
import { resolverCiudadEfectiva, VERSION_RESOLUTOR_ACTUAL, type CiudadEfectiva } from "@/lib/lugares/ciudad";
import { relojReal, type Reloj } from "@/lib/lugares/limitador";
import { normalizarNombre } from "@/lib/lugares/normalizar";
import type { CajaDelimitadora, FuenteCiudad, FuenteFotos, FuenteLugares } from "@/lib/lugares/tipos";
import type { CategoriaParada, Lugar } from "@/lib/plan/tipos";
import { ETIQUETA_OSM_POR_CATEGORIA, type FuenteCercanos } from "@/lib/alternativas/cercanos";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { esLaMismaParadaDelPlan } from "@/lib/alternativas/resolverAlternativas";

const MAXIMO_CERCANOS = 3;

// bar-ac3: 120 paradas o 180 s de reloj (lo que ocurra primero), para vaciar
// las 467 pendientes en ~4 ticks sin solaparse con el cron de 5 min.
export const LIMITE_BARRIDO_DEFECTO = 120;
export const PRESUPUESTO_BARRIDO_MS_DEFECTO = 180_000;
const DIAS_CADUCIDAD_NO_RESUELTA = 30;

export interface CandidatoPendiente {
  paradaId: string;
  fecha: string;
}

// rel-ac3: la métrica es la distancia absoluta a hoy, no la fecha en bruto
// -- así "hoy" o "en curso" gana siempre, y un viaje lejano en el futuro
// pierde contra uno ya pasado exactamente igual que contra uno próximo,
// que es lo que pide el criterio ("lejanos O pasados" al mismo nivel).
// bar-ac1: ahora compara paradas de planes DISTINTOS, no solo de un mismo
// plan -- el criterio "por cercanía... ahora también entre planes" es
// automático porque el array de entrada ya mezcla todos los planes.
export function seleccionarPendientes<T extends CandidatoPendiente>(
  candidatos: T[],
  limite: number,
  hoy: string = new Date().toISOString().slice(0, 10),
): T[] {
  const hoyMs = Date.parse(hoy);
  return [...candidatos]
    .sort((a, b) => Math.abs(Date.parse(a.fecha) - hoyMs) - Math.abs(Date.parse(b.fecha) - hoyMs))
    .slice(0, limite);
}

// bar-ac3: separado de la obtención de datos para que el tope y el
// presupuesto se puedan probar con `npm test` (reloj falso, sin tocar
// Supabase) en vez de depender de la pila de integración.
export async function procesarDentroDePresupuesto<T>(
  seleccionados: T[],
  presupuestoMs: number,
  reloj: Reloj,
  ejecutar: (candidato: T) => Promise<void>,
): Promise<number> {
  const inicio = reloj.ahora();
  let procesados = 0;
  for (const candidato of seleccionados) {
    if (reloj.ahora() - inicio >= presupuestoMs) break;
    await ejecutar(candidato);
    procesados++;
  }
  return procesados;
}

interface FilaParada {
  id: string;
  nombre: string;
  categoria: CategoriaParada | null;
  dia_index: number;
  plan_version_id: string;
  resolucion: { estado: "resuelta" | "no-resuelta" | "error"; intentado_en: string } | null;
  // alt-ac1: añadidos para el tercer barrido (alternativas) -- lat/lon y
  // lugar ya los traía la respuesta de ubicación de este mismo tick o de
  // uno anterior; duracion_min y alternativas_intentadas_en son nuevos
  // solo para esta lectura, no se escribían antes en esta consulta.
  lat: number | null;
  lon: number | null;
  lugar: Lugar | null;
  duracion_min: number;
  alternativas_intentadas_en: string | null;
}

interface FilaPlanRelacionado {
  id: string;
  destino: string;
  ciudad: CiudadEfectiva | null;
}

interface VersionDePlan {
  id: string;
  planId: string;
  destino: string;
  ciudad: CiudadEfectiva | null;
  dias: Array<{ fecha: string }>;
}

function estaPendiente(resolucion: FilaParada["resolucion"], cutoffIso: string): boolean {
  if (!resolucion) return true;
  if (resolucion.estado === "error") return true;
  if (resolucion.estado === "no-resuelta") return resolucion.intentado_en < cutoffIso;
  return false;
}

interface CandidatoBarrido extends CandidatoPendiente {
  nombre: string;
  categoria: CategoriaParada | undefined;
  cualificador: string;
  bbox: CajaDelimitadora;
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04): contadores de qué pasó con
// la ciudad de cada plan mirado este tick, para distinguir desde fuera (sin
// acceso a la base real) un plan que se saltó porque ya está sellado con la
// versión vigente de uno que se saltó por un fallo de red pasajero -- antes
// ambos casos eran indistinguibles mirando solo paradasIntentadas.
export interface ContadoresCiudad {
  resueltos: number;
  reintentados: number;
  saltadosSellados: number;
  saltadosPorRed: number;
}

export function crearContadoresCiudad(): ContadoresCiudad {
  return { resueltos: 0, reintentados: 0, saltadosSellados: 0, saltadosPorRed: 0 };
}

// bar-ac1: la puerta de la ciudad para un plan concreto -- devuelve el
// cualificador/caja a usar para sus paradas pendientes, o null si el plan
// se tiene que saltar este tick (sin ciudad identificable, o un fallo de
// red al intentar resolverla/geocodificarla, que se reintenta en el
// siguiente tick en vez de abortar el barrido entero).
export async function resolverPuertaDeCiudad(
  supabase: SupabaseClient,
  fuente: FuenteLugares & FuenteCiudad,
  version: VersionDePlan,
  nombresTodasLasParadas: string[],
  contadores?: ContadoresCiudad,
): Promise<{ nombre: string; caja: CajaDelimitadora } | null> {
  let ciudad = version.ciudad;

  // bar-ac2/bar-ac4 (feedback del gatekeeper, 2026-10-04): un
  // "sin-ciudad-identificable" sellado por una versión del resolutor
  // ANTERIOR a la vigente es un veredicto de lógica ya corregida, no una
  // conclusión sobre el plan -- se reintenta una vez, igual que un plan
  // nuevo. El propio resolverCiudadEfectiva sella el resultado con la
  // versión vigente, así que si vuelve a salir "sin-ciudad-identificable"
  // ya no se reintenta más (ausencia de sello se trata como "anterior a
  // cualquier versión", nunca como si ya estuviera al día).
  const marcadoPorVersionAnterior =
    ciudad?.estado === "sin-ciudad-identificable" && (ciudad.version_resolutor ?? 0) < VERSION_RESOLUTOR_ACTUAL;

  if (ciudad?.estado === "sin-ciudad-identificable" && !marcadoPorVersionAnterior) {
    if (contadores) contadores.saltadosSellados++;
  }

  if (ciudad === null || marcadoPorVersionAnterior) {
    if (contadores) contadores.reintentados++;
    const resultado = await resolverCiudadEfectiva(fuente, version.destino, nombresTodasLasParadas);
    if (resultado === null) {
      if (contadores) contadores.saltadosPorRed++;
      return null; // fallo de red: se reintenta en el siguiente tick
    }
    ciudad = resultado;
    await supabase.from("planes").update({ ciudad }).eq("id", version.planId);
  } else if (ciudad.estado === "pendiente-manual") {
    const nombrePedido = ciudad.nombre_pedido ?? "";
    const caja = nombrePedido ? await fuente.geocodificarCiudad(nombrePedido) : null;
    const ahora = new Date().toISOString();
    ciudad = caja
      ? { estado: "resuelta", metodo: "manual", nombre: nombrePedido, caja, intentado_en: ahora }
      : {
          estado: "sin-ciudad-identificable",
          motivo: `No hemos encontrado «${nombrePedido}» en el mapa: comprueba el nombre`,
          intentado_en: ahora,
          version_resolutor: VERSION_RESOLUTOR_ACTUAL,
        };
    await supabase.from("planes").update({ ciudad }).eq("id", version.planId);
  }

  if (ciudad.estado === "resuelta" && ciudad.nombre && ciudad.caja) {
    if (contadores) contadores.resueltos++;
    return { nombre: ciudad.nombre, caja: ciudad.caja };
  }
  // bar-ac2: "sin-ciudad-identificable" (o un "resuelta" sin caja, que no
  // debería darse) no produce ninguna petición para sus paradas.
  return null;
}

// Feedback del gatekeeper (bar-ac4, 2026-10-04): sin esto, un tick que se
// queda colgado (código viejo en VPS1, una excepción que aborta el
// barrido, o un reintento que de verdad se hizo y salió negativo) son tres
// hipótesis indistinguibles desde fuera. `planesMirados` es el número de
// planes con al menos una parada pendiente considerados este tick (tengan
// o no ciudad ya resuelta); `paradasIntentadas` es el de ubicaciones
// intentadas. tick.ts los persiste en `salud.resultado`.
export interface ResultadoBarrido {
  planesMirados: number;
  paradasIntentadas: number;
  planesResueltos: number;
  planesReintentados: number;
  planesSaltadosSellados: number;
  planesSaltadosPorRed: number;
}

// rel-ac1/rel-ac2/bar-ac1: cumple la decisión de Adrián -- coordenadas (y
// fotos) de TODOS los planes con al menos una versión, tengan o no trabajo
// vivo, sin invocar al modelo y sin regenerar el plan. ciu-ac1/ciu-ac3: el
// cualificador geográfico y la caja de cada parada vienen de la ciudad
// efectiva del plan, nunca del texto crudo de `destino`.
export async function completarParadasPendientes(
  supabase: SupabaseClient,
  fuente: FuenteLugares & FuenteCiudad,
  limite: number = LIMITE_BARRIDO_DEFECTO,
  fuenteFotos?: FuenteFotos,
  reloj: Reloj = relojReal,
  presupuestoMs: number = PRESUPUESTO_BARRIDO_MS_DEFECTO,
  fuenteCercanos?: FuenteCercanos,
): Promise<ResultadoBarrido> {
  // bar-ac1: el alcance ya no parte de `trabajos` -- parte de TODO plan con
  // al menos una versión, viva o no. Un plan sin ninguna fila en
  // `plan_versiones` (el caso "Oporto") simplemente no aparece aquí.
  const { data: versiones, error: errorVersiones } = await supabase
    .from("plan_versiones")
    .select("id, plan_id, version, dias, planes(id, destino, ciudad)")
    .order("version", { ascending: false });
  if (errorVersiones) throw new Error(`No se pudieron leer las versiones: ${errorVersiones.message}`);

  // Solo la ÚLTIMA versión de cada plan (la primera que aparece tras
  // ordenar por version descendente): las versiones anteriores quedan
  // congeladas en el historial y no necesitan barrido.
  const ultimaVersionPorPlan = new Map<string, VersionDePlan>();
  for (const fila of versiones ?? []) {
    const planId = fila.plan_id as string;
    if (ultimaVersionPorPlan.has(planId)) continue;
    const planesRelacionados = fila.planes as FilaPlanRelacionado | FilaPlanRelacionado[] | null;
    const plan = Array.isArray(planesRelacionados) ? planesRelacionados[0] : planesRelacionados;
    if (!plan?.destino) continue;
    ultimaVersionPorPlan.set(planId, {
      id: fila.id as string,
      planId,
      destino: plan.destino,
      ciudad: plan.ciudad ?? null,
      dias: fila.dias as Array<{ fecha: string }>,
    });
  }
  const versionPorId = new Map<string, VersionDePlan>();
  for (const version of ultimaVersionPorPlan.values()) versionPorId.set(version.id, version);
  const versionIds = [...versionPorId.keys()];
  if (versionIds.length === 0) {
    return { planesMirados: 0, paradasIntentadas: 0, planesResueltos: 0, planesReintentados: 0, planesSaltadosSellados: 0, planesSaltadosPorRed: 0 };
  }

  const { data: paradas, error: errorParadas } = await supabase
    .from("paradas")
    .select("id, nombre, categoria, dia_index, plan_version_id, resolucion, lat, lon, lugar, duracion_min, alternativas_intentadas_en")
    .in("plan_version_id", versionIds);
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);

  const cutoffIso = new Date(Date.now() - DIAS_CADUCIDAD_NO_RESUELTA * 24 * 60 * 60 * 1000).toISOString();

  const nombresPorVersion = new Map<string, string[]>();
  const pendientesPorVersion = new Map<string, FilaParada[]>();
  // alt-ac1: identidades de CUALQUIER parada de la versión (nombre
  // normalizado + lugar.id si ya está resuelta), para que el barrido de
  // alternativas no proponga como "cercano" un sitio que ya forma parte
  // del propio plan -- el mismo filtro que resolverAlternativasPlan usa
  // en la generación, reconstruido aquí desde las filas en vez del
  // objeto Plan.
  const identidadesPorVersion = new Map<string, Set<string>>();
  for (const fila of (paradas as FilaParada[] | null) ?? []) {
    const nombres = nombresPorVersion.get(fila.plan_version_id) ?? [];
    nombres.push(fila.nombre);
    nombresPorVersion.set(fila.plan_version_id, nombres);

    const identidades = identidadesPorVersion.get(fila.plan_version_id) ?? new Set<string>();
    identidades.add(normalizarNombre(fila.nombre));
    if (fila.lugar?.id) identidades.add(fila.lugar.id);
    identidadesPorVersion.set(fila.plan_version_id, identidades);

    if (!estaPendiente(fila.resolucion, cutoffIso)) continue;
    const pendientes = pendientesPorVersion.get(fila.plan_version_id) ?? [];
    pendientes.push(fila);
    pendientesPorVersion.set(fila.plan_version_id, pendientes);
  }

  // bar-ac1/ciu-ac1: la puerta de la ciudad solo se cruza para los planes
  // que de verdad tienen algo pendiente -- un plan ya resuelto del todo no
  // gasta ni una petición de ciudad, la tenga o no ya persistida.
  const candidatos: CandidatoBarrido[] = [];
  let planesMirados = 0;
  const contadoresCiudad = crearContadoresCiudad();
  for (const [versionId, pendientes] of pendientesPorVersion) {
    if (pendientes.length === 0) continue;
    const version = versionPorId.get(versionId);
    if (!version) continue;
    planesMirados++;

    const cualificador = await resolverPuertaDeCiudad(
      supabase,
      fuente,
      version,
      nombresPorVersion.get(versionId) ?? [],
      contadoresCiudad,
    );
    if (!cualificador) continue;

    for (const parada of pendientes) {
      candidatos.push({
        paradaId: parada.id,
        nombre: parada.nombre,
        categoria: parada.categoria ?? undefined,
        cualificador: cualificador.nombre,
        bbox: cualificador.caja,
        fecha: version.dias[parada.dia_index]?.fecha ?? "9999-12-31",
      });
    }
  }

  const seleccionados = seleccionarPendientes(candidatos, limite);

  const procesados = await procesarDentroDePresupuesto(seleccionados, presupuestoMs, reloj, async (candidato) => {
    try {
      const resultado = await resolverNombre(fuente, candidato.nombre, candidato.categoria, candidato.cualificador, candidato.bbox);
      const { error: errorUpdate } = await supabase
        .from("paradas")
        .update({
          lat: resultado.coordenadas?.lat ?? null,
          lon: resultado.coordenadas?.lon ?? null,
          lugar: resultado.lugar ?? null,
          resolucion: resultado.resolucion,
        })
        .eq("id", candidato.paradaId);
      if (errorUpdate) throw new Error(errorUpdate.message);
    } catch (error) {
      await supabase
        .from("paradas")
        .update({
          resolucion: {
            estado: "error",
            intentado_en: new Date().toISOString(),
            motivo: error instanceof Error ? error.message : "fallo desconocido en el barrido",
          },
        })
        .eq("id", candidato.paradaId);
    }
  });

  // fot-ac4: segundo barrido, después del de ubicación y dentro del mismo
  // tope -- paradas YA resueltas (de este barrido o de uno anterior, o de
  // una generación reciente) que todavía no tienen foto ni se han
  // intentado. Un fallo en una foto concreta nunca tumba el tick: deja
  // constancia del intento (foto_intentada_en) y sigue con la siguiente.
  // bar-ac1: `versionIds` ya cubre TODOS los planes con versión, vivos o no.
  if (fuenteFotos) {
    const { data: paradasSinFoto, error: errorFotos } = await supabase
      .from("paradas")
      .select("id, categoria, lat, lon, lugar")
      .in("plan_version_id", versionIds)
      .eq("resolucion->>estado", "resuelta")
      .is("foto", null)
      .is("foto_intentada_en", null)
      .limit(limite);
    if (errorFotos) throw new Error(`No se pudieron leer las paradas sin foto: ${errorFotos.message}`);

    for (const fila of paradasSinFoto ?? []) {
      try {
        const lugar = (fila.lugar as Lugar | null) ?? undefined;
        const categoria = (fila.categoria as CategoriaParada | null) ?? undefined;
        const coordenadas =
          fila.lat !== null && fila.lon !== null ? { lat: fila.lat as number, lon: fila.lon as number } : undefined;
        const foto = await resolverFoto(fuenteFotos, lugar, categoria, coordenadas);
        await supabase
          .from("paradas")
          .update({ foto: foto ?? null, foto_intentada_en: new Date().toISOString() })
          .eq("id", fila.id);
      } catch {
        await supabase.from("paradas").update({ foto_intentada_en: new Date().toISOString() }).eq("id", fila.id);
      }
    }
  }

  // alt-ac1: tercer barrido, después del de ubicación y del de fotos y
  // dentro del mismo tope -- paradas YA resueltas (de este barrido, de uno
  // anterior o de una generación reciente), sin alternativas intentadas
  // todavía, para las que se pide a Overpass hasta 3 cercanos de origen
  // 'cercano'. El intento se marca SIEMPRE (éxito, 0 resultados o fallo de
  // Overpass) para no volver a preguntar en el siguiente tick. Consulta
  // fresca a la BD, igual que el barrido de fotos de arriba, para que una
  // parada recién resuelta en ESTE mismo tick entre también.
  if (fuenteCercanos) {
    interface FilaParadaSinAlternativas {
      id: string;
      categoria: CategoriaParada | null;
      lat: number | null;
      lon: number | null;
      plan_version_id: string;
      duracion_min: number;
    }

    const { data: paradasSinAlternativas, error: errorAlternativas } = await supabase
      .from("paradas")
      .select("id, categoria, lat, lon, plan_version_id, duracion_min")
      .in("plan_version_id", versionIds)
      .eq("resolucion->>estado", "resuelta")
      .is("alternativas_intentadas_en", null)
      .limit(limite);
    if (errorAlternativas) throw new Error(`No se pudieron leer las paradas sin alternativas: ${errorAlternativas.message}`);

    for (const fila of (paradasSinAlternativas as FilaParadaSinAlternativas[] | null) ?? []) {
      const identidades = identidadesPorVersion.get(fila.plan_version_id) ?? new Set<string>();
      try {
        if (!fila.categoria || fila.lat === null || fila.lon === null) {
          await supabase.from("paradas").update({ alternativas_intentadas_en: new Date().toISOString() }).eq("id", fila.id);
          continue;
        }
        const categoria = fila.categoria;
        const lat = fila.lat;
        const lon = fila.lon;
        const cercanos = await fuenteCercanos.buscar(categoria, lat, lon);
        const ajenos = cercanos.filter(
          (cercano) => !esLaMismaParadaDelPlan({ nombre: cercano.nombre, lugar: { id: cercano.id } }, identidades),
        );
        const etiqueta = ETIQUETA_OSM_POR_CATEGORIA[categoria];
        for (const cercano of ajenos.slice(0, MAXIMO_CERCANOS)) {
          const distanciaM = distanciaMetros({ lat, lon }, cercano);
          const { error: errorInsert } = await supabase.from("paradas_alternativas").insert({
            parada_id: fila.id,
            origen: "cercano",
            nombre: cercano.nombre,
            descripcion: `Sitio cercano de la categoría '${fila.categoria}' según OpenStreetMap.`,
            motivo: `A ${Math.round(distanciaM)} m, misma categoría (${etiqueta}) según OpenStreetMap.`,
            duracion_min: fila.duracion_min,
            categoria: fila.categoria,
            lat: cercano.lat,
            lon: cercano.lon,
            lugar: {
              fuente: "osm",
              id: cercano.id,
              url: `https://www.openstreetmap.org/${cercano.id.replace("osm:", "")}`,
              nombre_fuente: cercano.nombre,
              etiquetas: {},
              resuelto_en: new Date().toISOString(),
            },
          });
          if (errorInsert) throw new Error(errorInsert.message);
        }
        await supabase.from("paradas").update({ alternativas_intentadas_en: new Date().toISOString() }).eq("id", fila.id);
      } catch {
        await supabase.from("paradas").update({ alternativas_intentadas_en: new Date().toISOString() }).eq("id", fila.id);
      }
    }
  }

  return {
    planesMirados,
    paradasIntentadas: procesados,
    planesResueltos: contadoresCiudad.resueltos,
    planesReintentados: contadoresCiudad.reintentados,
    planesSaltadosSellados: contadoresCiudad.saltadosSellados,
    planesSaltadosPorRed: contadoresCiudad.saltadosPorRed,
  };
}
