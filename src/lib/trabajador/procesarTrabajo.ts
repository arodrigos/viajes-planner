import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { postProcesarPlan } from "@/lib/generacion/postProcesar";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { validarPlan, type ErrorValidacion } from "@/lib/plan/validar";
import { guardarPlan } from "@/lib/plan/repositorio";
import { CATEGORIAS_PARADA, type Alternativa, type Dia, type Franja, type Parada, type Plan, type Recomendacion, type TipoRecomendacion } from "@/lib/plan/tipos";
import { crearFuenteAbierta } from "@/lib/lugares/fuenteAbierta";
import { cacheSitiosSupabase } from "@/lib/lugares/cacheSitios";
import { resolverPlan } from "@/lib/lugares/resolverPlan";
import { crearFuenteFotosAbierta } from "@/lib/lugares/fuenteFotosAbierta";
import { resolverFotosPlan } from "@/lib/lugares/resolverFotos";
import type { FuenteFotos, FuenteLugares } from "@/lib/lugares/tipos";
import { crearFuenteCercanosAbierta, type FuenteCercanos } from "@/lib/alternativas/cercanos";
import { resolverAlternativasPlan } from "@/lib/alternativas/resolverAlternativas";
import { familiaDeModelo, registrarLecturaCuota } from "./cuota";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "./ejecutorModelo";
import { construirPrompt, construirPromptReintento } from "./prompt";
import { generarIdParada, generarIdPlan } from "./id";
import { MODELO_GENERACION } from "./config";

const CATEGORIAS_VALIDAS = new Set<string>(CATEGORIAS_PARADA);

export interface TrabajoAProcesar {
  id: string;
  plan_id: string | null;
  criterios: CriteriosViaje;
}

interface DependenciasProcesarTrabajo {
  ejecutor: EjecutorModelo;
  directorio: string;
  // lug-ac3: inyectable para que los tests del trabajador que no son de
  // lugares-resolucion (trabajador-ac2, trabajador-ac3, cuota) no disparen
  // peticiones reales a Nominatim/Wikipedia -- sin esto, cada test que
  // llega a "completado" colgaba el job de CI contra la red real. Por
  // defecto, la fuente abierta de verdad.
  fuenteLugares?: FuenteLugares;
  // fot-ac1: mismo motivo que fuenteLugares, para Wikipedia/Commons.
  fuenteFotos?: FuenteFotos;
  // alt-ac4: mismo motivo que fuenteLugares, para el complemento de
  // Overpass.
  fuenteCercanos?: FuenteCercanos;
}

type IntentoEnsamblado = { valido: true; plan: Plan } | { valido: false; errores: ErrorValidacion[] };

// trabajador-ac1 (real, 2026-09-21): el prompt (prompt.ts) ya pide
// "ÚNICAMENTE un objeto JSON, sin texto fuera del JSON" -- eso es una
// PREFERENCIA, no una garantía. La primera vez que este código invocó al
// modelo de verdad, envolvió la respuesta en una valla de markdown
// (```json ... ```) pese a la instrucción explícita, dos veces seguidas
// (intento y reintento). La red real contra ese comportamiento conocido de
// los modelos es esta extracción, no el texto del prompt.
function extraerJson(texto: string): string {
  const conValla = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (conValla) return conValla[1];
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio !== -1 && fin > inicio) return texto.slice(inicio, fin + 1);
  return texto;
}

// trabajador-ac2, ampliado tras la primera invocación real (2026-09-21): el
// modelo solo aporta, por parada, lo que de verdad puede originar --
// nombre, descripcion, duracion_min, prioridad, franja_id. Todo lo demás lo
// fija el proceso, nunca el modelo:
// - id (de plan y de cada parada): el modelo nunca decide identidad.
// - franjas: horario determinista por destino (config-franjas.ts). Pedirle
//   al modelo que reproduzca id/etiqueta/hora_inicio/hora_fin es la misma
//   trampa que pedirle procedencia -- y en la práctica nunca acertaba el
//   formato exacto.
// - procedencia: único valor posible en fase 1 (tipos.ts). Pedírsela al
//   modelo es invitarlo a inventar con formato correcto un dato sobre sí
//   mismo que no puede saber de verdad.
// - ancla_alojamiento: fase 1 no resuelve ubicaciones reales (F2-06); se
//   omite siempre, nunca a medias con datos que el modelo se inventaría.
export function ensamblarYValidar(criterios: CriteriosViaje, planId: string, texto: string): IntentoEnsamblado {
  let datos: unknown;
  try {
    datos = JSON.parse(extraerJson(texto));
  } catch {
    return { valido: false, errores: [{ ruta: "(raíz)", mensaje: "la respuesta del modelo no es JSON válido" }] };
  }

  const diasCrudos = (datos as { dias?: unknown }).dias;
  const franjas = franjasComoArray(criterios.destino_o_tipo);
  const dias: Dia[] = Array.isArray(diasCrudos)
    ? diasCrudos.map((diaCrudo) => ensamblarDia(diaCrudo as Record<string, unknown> | null, franjas))
    : [];

  const recomendacionesCrudas = (datos as { recomendaciones?: unknown }).recomendaciones;
  const recomendaciones: Recomendacion[] = Array.isArray(recomendacionesCrudas)
    ? recomendacionesCrudas.map((recomendacionCruda) =>
        ensamblarRecomendacion(recomendacionCruda as Record<string, unknown> | null),
      )
    : [];

  const candidato: Plan = {
    id: planId,
    version: 1,
    destino: criterios.destino_o_tipo,
    personas: criterios.personas.length,
    dias,
    recomendaciones,
  };

  const resultado = validarPlan(candidato);
  return resultado.valido ? { valido: true, plan: candidato } : { valido: false, errores: resultado.errores };
}

function ensamblarDia(diaCrudo: Record<string, unknown> | null, franjas: Franja[]): Dia {
  const paradasCrudas = diaCrudo?.paradas;
  return {
    fecha: diaCrudo?.fecha as string,
    franjas,
    paradas: Array.isArray(paradasCrudas)
      ? paradasCrudas.map((paradaCruda) => ensamblarParada(paradaCruda as Record<string, unknown> | null))
      : [],
  };
}

// lug-ac4: `categoria` es lo único nuevo que el ensamblador copia del
// modelo en este bloque, y solo si es uno de los valores del enum cerrado
// -- un valor inventado se descarta sin invalidar el plan, igual que
// cualquier otro campo (coordenadas, lugar, url) que el modelo devuelva
// sin que se le haya pedido.
function ensamblarParada(paradaCruda: Record<string, unknown> | null): Parada {
  const categoriaCruda = paradaCruda?.categoria;
  const categoria = typeof categoriaCruda === "string" && CATEGORIAS_VALIDAS.has(categoriaCruda) ? categoriaCruda : undefined;
  const alternativas = ensamblarAlternativas(paradaCruda?.alternativas);
  return {
    id: generarIdParada(),
    franja_id: paradaCruda?.franja_id as string,
    nombre: paradaCruda?.nombre as string,
    descripcion: paradaCruda?.descripcion as string,
    duracion_min: paradaCruda?.duracion_min as number,
    prioridad: paradaCruda?.prioridad as number,
    procedencia: { fuente: "propuesto-sin-verificar" },
    ...(categoria ? { categoria: categoria as Parada["categoria"] } : {}),
    ...(alternativas.length > 0 ? { alternativas } : {}),
  };
}

// alt-ac2: copia SOLO nombre/descripcion/motivo/duracion_min -cualquier
// otro campo que el modelo devuelva (url, coordenadas, categoria) se
// descarta aquí, nunca llega al candidato-; descarta las alternativas sin
// los cuatro campos válidos sin invalidar el plan, y recorta a 3 por
// orden (el modelo ya puede devolver como máximo 3, pero esto no confía
// en que lo respete).
function ensamblarAlternativas(alternativasCrudas: unknown): Alternativa[] {
  if (!Array.isArray(alternativasCrudas)) return [];
  const validas: Alternativa[] = [];
  for (const cruda of alternativasCrudas as Array<Record<string, unknown> | null>) {
    const nombre = cruda?.nombre;
    const descripcion = cruda?.descripcion;
    const motivo = cruda?.motivo;
    const duracionMin = cruda?.duracion_min;
    if (
      typeof nombre === "string" &&
      nombre.length > 0 &&
      typeof descripcion === "string" &&
      descripcion.length > 0 &&
      typeof motivo === "string" &&
      motivo.length > 0 &&
      typeof duracionMin === "number" &&
      duracionMin > 0
    ) {
      validas.push({ nombre, descripcion, motivo, duracion_min: duracionMin });
    }
  }
  return validas.slice(0, 3);
}

// reco-ac3: el modelo solo aporta tipo/nombre/motivo -- cualquier "url" u
// otro campo que devuelva se descarta aquí, nunca llega al plan guardado.
// Igual que ensamblarParada con procedencia: la defensa real no es pedirlo
// bien en el prompt, es que este ensamblador no copia campos que no pidió.
function ensamblarRecomendacion(recomendacionCruda: Record<string, unknown> | null): Recomendacion {
  return {
    tipo: recomendacionCruda?.tipo as TipoRecomendacion,
    nombre: recomendacionCruda?.nombre as string,
    motivo: recomendacionCruda?.motivo as string,
  };
}

async function publicarEtapa(supabase: SupabaseClient, trabajoId: string, etapa: string): Promise<void> {
  await supabase.from("trabajos").update({ etapa, actualizado_en: new Date().toISOString() }).eq("id", trabajoId);
}

async function pausarPorCuota(
  supabase: SupabaseClient,
  trabajoId: string,
  motivo: string,
  reintentoNoAntesDe: string | null,
): Promise<void> {
  await supabase
    .from("trabajos")
    .update({
      estado: "pausado-por-cuota",
      motivo,
      reintento_no_antes_de: reintentoNoAntesDe,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", trabajoId);
}

type RespuestaOLimitada = ResultadoInvocacion | { limitado: true };

// trabajador-ac4 (b): un límite de uso a media invocación no debe crashear
// ni perder el trabajo — queda pausado con el motivo real del modelo y su
// hora de reinicio exacta. trabajador-ac5: la lectura solo se registra
// cuando el ejecutor de verdad sabe el porcentaje consumido (nunca hoy, en
// modo headless); si usedPercentage es null no se escribe ninguna fila
// inventada en uso_suscripcion.
async function invocarOPausar(
  supabase: SupabaseClient,
  trabajoId: string,
  familia: ReturnType<typeof familiaDeModelo>,
  ejecutor: EjecutorModelo,
  prompt: string,
  directorio: string,
): Promise<RespuestaOLimitada> {
  try {
    return await ejecutor.invocar(prompt, { directorio, modelo: MODELO_GENERACION });
  } catch (error) {
    if (!(error instanceof LimiteDeUsoAlcanzado)) throw error;
    if (error.usedPercentage !== null) {
      await registrarLecturaCuota(supabase, familia, error.usedPercentage, error.resetsAt);
    }
    await pausarPorCuota(supabase, trabajoId, error.message, error.resetsAt);
    return { limitado: true };
  }
}

// trabajador-ac1 (no en CI, ver ejecutorModelo.ts) / trabajador-ac2: un
// trabajo se completa de extremo a extremo o queda 'fallido' con motivo;
// nunca hay una escritura a medias en planes. trabajador-ac4: ya no hay
// pre-chequeo — con la cola no vacía el trabajador invoca siempre; el
// único mecanismo de cuota es la pausa reactiva de invocarOPausar.
export async function procesarTrabajo(
  supabase: SupabaseClient,
  trabajo: TrabajoAProcesar,
  { ejecutor, directorio, fuenteLugares, fuenteFotos, fuenteCercanos }: DependenciasProcesarTrabajo,
): Promise<{ estado: "completado" | "fallido" | "pausado-por-cuota" }> {
  const familia = familiaDeModelo(MODELO_GENERACION);

  await publicarEtapa(supabase, trabajo.id, "preparando la petición");
  const planId = trabajo.plan_id ?? generarIdPlan();

  await publicarEtapa(supabase, trabajo.id, "generando el plan");
  const prompt = construirPrompt(trabajo.criterios);
  const primeraRespuesta = await invocarOPausar(supabase, trabajo.id, familia, ejecutor, prompt, directorio);
  if ("limitado" in primeraRespuesta) return { estado: "pausado-por-cuota" };
  let intento = ensamblarYValidar(trabajo.criterios, planId, primeraRespuesta.texto);

  if (!intento.valido) {
    const promptReintento = construirPromptReintento(prompt, intento.errores);
    const segundaRespuesta = await invocarOPausar(supabase, trabajo.id, familia, ejecutor, promptReintento, directorio);
    if ("limitado" in segundaRespuesta) return { estado: "pausado-por-cuota" };
    intento = ensamblarYValidar(trabajo.criterios, planId, segundaRespuesta.texto);
  }

  if (!intento.valido) {
    const motivo = intento.errores.map((e) => `${e.ruta}: ${e.mensaje}`).join("; ");
    await supabase
      .from("trabajos")
      .update({ estado: "fallido", motivo, actualizado_en: new Date().toISOString() })
      .eq("id", trabajo.id);
    return { estado: "fallido" };
  }

  // generacion-ac1/ac2: red de seguridad determinista sobre el plan ya
  // validado estructuralmente, no una confianza ciega en que el modelo
  // obedeció el tope y la exclusión de categorías pedidos en el prompt.
  const { plan: planPostProcesado } = postProcesarPlan(intento.plan, trabajo.criterios);

  await publicarEtapa(supabase, trabajo.id, "ubicando las paradas");
  // lug-ac1: resolución real contra las fuentes abiertas (Nominatim +
  // respaldo Wikipedia), con caché y límite de ritmo en cacheSitios.ts y
  // limitador.ts. Una parada que no resuelve nunca hace fallar el trabajo
  // -resolverPlan la deja con resolucion.estado y el plan se guarda igual.
  const fuente = fuenteLugares ?? crearFuenteAbierta({ cache: cacheSitiosSupabase(supabase) });
  const planConLugares = await resolverPlan(fuente, planPostProcesado);

  // fot-ac1: fotos de las paradas ya resueltas, en el mismo paso visible
  // "ubicando las paradas" -- no se anuncia una etapa nueva para no
  // romper la secuencia que lug-ac6 ya comprueba.
  const fotos = fuenteFotos ?? crearFuenteFotosAbierta();
  const planConFotos = await resolverFotosPlan(fotos, planConLugares);

  // alt-ac1/alt-ac3/alt-ac4: alternativas SOLO para viajes nuevos (decisión
  // de Adrián) -- es justo lo que genera este paso, nunca el barrido de
  // planes existentes (relleno-planes-existentes no toca `alternativas`).
  // alt-ac4: misma caché persistente que lug-ac3 exige para Nominatim --
  // en memoria se evaporaba en cada tick del trabajador (un proceso nuevo
  // por tick), así que nunca evitaba una segunda petición real a Overpass.
  const cercanos = fuenteCercanos ?? crearFuenteCercanosAbierta({ cache: cacheSitiosSupabase(supabase) });
  const planFinal = await resolverAlternativasPlan(fuente, cercanos, planConFotos, trabajo.criterios.perfil);

  await publicarEtapa(supabase, trabajo.id, "guardando");
  await guardarPlan(supabase, planFinal);
  await supabase
    .from("trabajos")
    .update({ estado: "completado", plan_id: planId, etapa: "guardando", actualizado_en: new Date().toISOString() })
    .eq("id", trabajo.id);
  return { estado: "completado" };
}
