// etapas-pais: del texto del modelo a un plan con etapas, traslados y
// presupuesto que el sistema ha comprobado. Todo puro salvo `situarEtapas`,
// que usa la fuente de ciudades inyectada (1 petición por etapa).
import type { Modo } from "@/lib/criterios/tipos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { CajaDelimitadora, FuenteCiudad } from "@/lib/lugares/tipos";
import { ensamblarMotivo } from "@/lib/presupuesto/ensamblar";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import type { EtapaPlan, Plan, TrasladoPlan } from "@/lib/plan/tipos";
import type { Zona } from "./clasificar";
import { PISO_ALOJAMIENTO_EUR } from "./constantes";
import { MAX_ETAPAS } from "./reglas";
import { asignarZona, llegadasOcupadas, repararEtapas, textoAjusteLlegada, trasladosDe, validarEtapas, type ContextoEtapas, type ErrorEtapa, type EtapaGeo } from "./validar";
import type { Inviable, Razon } from "./viabilidad";

const GRADOS_CIUDAD = 2;
const ALOJAMIENTO_MAX_EUR = 5000;
const NOMBRE_MAX = 80;

function textoCorto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Estos textos acaban en una consulta a Nominatim y en la vista: sin
  // caracteres de control ni URLs.
  const t = v.replace(/[\u0000-\u001f]/g, " ").trim();
  return t.length >= 1 && t.length <= NOMBRE_MAX && !/https?:|javascript:|[<>]/i.test(t) ? t : null;
}

// Copia solo los campos pedidos y con tipo válido. Un alojamiento ausente o
// absurdo se sustituye por el piso de la viabilidad, y queda dicho.
export function extraerEtapasPropuestas(datos: unknown, personas: number): EtapaGeo[] {
  const crudas = (datos as { etapas?: unknown } | null)?.etapas;
  if (!Array.isArray(crudas)) return [];
  const etapas: EtapaGeo[] = [];
  for (const cruda of crudas.slice(0, MAX_ETAPAS + 4) as Array<Record<string, unknown> | null>) {
    const ciudad = textoCorto(cruda?.ciudad);
    const dias = cruda?.dias;
    if (!ciudad || typeof dias !== "number" || !Number.isInteger(dias) || dias < 1 || dias > 60) continue;
    const alojamiento = cruda?.alojamiento_noche_eur;
    const valido = typeof alojamiento === "number" && Number.isFinite(alojamiento) && alojamiento >= 0 && alojamiento <= ALOJAMIENTO_MAX_EUR;
    const motivo = ensamblarMotivo(cruda?.motivo);
    etapas.push({
      ciudad,
      pais: textoCorto(cruda?.pais) ?? "",
      dias,
      ...(motivo ? { motivo } : {}),
      alojamiento_noche_eur: valido ? alojamiento : PISO_ALOJAMIENTO_EUR * personas,
      punto: null,
      zona: null,
      ajustes: valido ? [] : [`${ciudad}: sin precio de alojamiento válido, se usa el mínimo de ${PISO_ALOJAMIENTO_EUR} € por persona y noche.`],
    });
  }
  return etapas;
}

const centro = (c: CajaDelimitadora) => ({ lat: (c.minLat + c.maxLat) / 2, lon: (c.minLon + c.maxLon) / 2 });
const extension = (c: CajaDelimitadora) => Math.max(c.maxLat - c.minLat, c.maxLon - c.minLon);

export interface EtapaSituada extends EtapaGeo {
  caja: CajaDelimitadora | null;
}

// Una petición por etapa, siempre por la fuente con su limitador y su caché.
// Una ciudad que no geocodifica, de más de 2 grados o fuera de las zonas
// pedidas queda sin punto o sin zona; la validación decide qué hacer con ella.
export async function situarEtapas(fuente: FuenteCiudad, etapas: readonly EtapaGeo[], zonas: readonly Zona[]): Promise<EtapaSituada[]> {
  const situadas: EtapaSituada[] = [];
  for (const e of etapas) {
    let caja: CajaDelimitadora | null = null;
    try {
      caja = await fuente.geocodificarCiudad(e.pais ? `${e.ciudad}, ${e.pais}` : e.ciudad);
    } catch {
      caja = null;
    }
    if (caja && extension(caja) > GRADOS_CIUDAD) caja = null;
    const punto = caja ? centro(caja) : null;
    situadas.push({ ...e, caja, punto, zona: punto ? asignarZona(punto, zonas) : null });
  }
  return situadas;
}

export function contextoDe(plan: Pick<Plan, "dias" | "personas">, zonas: readonly Zona[], modos: readonly Modo[], presupuestoEur: number): ContextoEtapas {
  return {
    zonas,
    modos,
    personas: plan.personas,
    diasTotales: plan.dias.length,
    presupuestoEur,
    actividadesEur: calcularPresupuesto({ personas: plan.personas, dias: plan.dias }).actividades_eur,
  };
}

// El modelo puede decir a qué etapa pertenece cada día; si el orden no es
// creciente, los días de una etapa no serían contiguos.
export function erroresDeDias(datos: unknown): ErrorEtapa[] {
  const dias = (datos as { dias?: unknown } | null)?.dias;
  if (!Array.isArray(dias)) return [];
  const indices = dias.map((d) => (d as { etapa?: unknown } | null)?.etapa).filter((e): e is number => typeof e === "number");
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] < indices[i - 1]) return [{ codigo: "dias", texto: "Los días de cada etapa tienen que ser contiguos: el campo etapa de los días no puede bajar." }];
  }
  return [];
}

export type ResultadoCierre = { inviable: false; plan: Plan } | { inviable: true; descarte: Inviable };

function razones(errores: readonly ErrorEtapa[]): Inviable {
  const vistas = new Set<string>();
  const unicas: Razon[] = [];
  for (const e of errores) {
    if (vistas.has(e.texto)) continue;
    vistas.add(e.texto);
    unicas.push({ codigo: e.codigo, texto: e.texto });
  }
  const sugerencias: string[] = [];
  if (unicas.some((r) => r.codigo === "presupuesto")) sugerencias.push("Sube el presupuesto o reduce los días, las personas o las ciudades.");
  if (unicas.some((r) => r.codigo === "distancia")) sugerencias.push("Marca «Avión» o elige zonas más cercanas.");
  if (unicas.some((r) => r.codigo === "zona-sin-etapa")) sugerencias.push("Prueba con menos zonas o con más días.");
  if (unicas.some((r) => r.codigo === "dias")) sugerencias.push("Alarga el viaje o pide menos ciudades.");
  return { razones: unicas, sugerencias };
}

// Repara, vacía las franjas de llegada, vuelve a comprobar con el gasto ya
// recalculado y devuelve el plan con etapas, traslados y ajustes, o el
// descarte con sus cifras. No se guarda un plan que no cabe.
export function cerrarEtapas(plan: Plan, propuestas: readonly EtapaSituada[], ctxBase: Omit<ContextoEtapas, "actividadesEur" | "diasTotales">): ResultadoCierre {
  const ctx = contextoDe(plan, ctxBase.zonas, ctxBase.modos, ctxBase.presupuestoEur);
  const cajas = new Map(propuestas.map((e) => [e.ciudad, e.caja] as const));
  const etapas = repararEtapas(propuestas, ctx);
  const tramos = trasladosDe(etapas, ctx.modos, ctx.personas);

  let diasConEtapa = plan.dias.map((d) => ({ ...d }));
  let inicio = 0;
  etapas.forEach((e, i) => {
    for (let d = inicio; d < inicio + e.dias && d < diasConEtapa.length; d++) diasConEtapa[d] = { ...diasConEtapa[d], etapa: i };
    inicio += e.dias;
  });

  // Franjas de llegada libres: se quitan las paradas que las ocupan.
  const ocupadas = tramos.every((t) => t !== null) ? llegadasOcupadas(diasConEtapa, etapas, tramos) : [];
  const ajustesLlegada = new Map<number, string[]>();
  for (const o of ocupadas) {
    const etapa = diasConEtapa[o.dia].etapa ?? 0;
    const franja = diasConEtapa[o.dia].franjas.find((f) => f.id === o.franja_id)?.etiqueta ?? o.franja_id;
    ajustesLlegada.set(etapa, [...(ajustesLlegada.get(etapa) ?? []), textoAjusteLlegada(etapas[etapa].ciudad, franja.toLowerCase())]);
    diasConEtapa = diasConEtapa.map((d, i) => (i === o.dia ? { ...d, paradas: d.paradas.filter((p) => p.franja_id !== o.franja_id) } : d));
  }

  const planConDias: Plan = { ...plan, dias: diasConEtapa };
  const ctxFinal = contextoDe(planConDias, ctxBase.zonas, ctxBase.modos, ctxBase.presupuestoEur);
  const errores = validarEtapas(etapas, ctxFinal, diasConEtapa);
  if (errores.length > 0) return { inviable: true, descarte: razones(errores) };

  const ahora = new Date().toISOString();
  inicio = 0;
  const etapasPlan: EtapaPlan[] = etapas.map((e, i) => {
    const caja = cajas.get(e.ciudad);
    const ciudad: CiudadEfectiva = caja
      ? { estado: "resuelta", nombre: e.ciudad, metodo: "destino", caja, intentado_en: ahora }
      : { estado: "sin-ciudad-identificable", nombre: e.ciudad, intentado_en: ahora };
    const etapa: EtapaPlan = {
      ciudad,
      pais: e.pais,
      dias: e.dias,
      dia_inicio: inicio,
      ...(e.motivo ? { motivo: e.motivo } : {}),
      alojamiento_noche_eur: e.alojamiento_noche_eur,
      zona: e.zona ?? 0,
      ajustes: [...e.ajustes, ...(ajustesLlegada.get(i) ?? [])],
    };
    inicio += e.dias;
    return etapa;
  });
  const traslados: TrasladoPlan[] = tramos.map((t, i) => ({ desde: etapas[i].ciudad, hasta: etapas[i + 1].ciudad, ...(t as NonNullable<typeof t>) }));
  return { inviable: false, plan: { ...planConDias, etapas: etapasPlan, traslados, ciudad: { estado: "multiciudad", intentado_en: ahora } } };
}

export function erroresParaReintento(errores: readonly ErrorEtapa[]): { ruta: string; mensaje: string }[] {
  return errores.map((e) => ({ ruta: "etapas", mensaje: e.texto }));
}

export function validarPropuesta(etapas: readonly EtapaSituada[], ctxBase: Omit<ContextoEtapas, "actividadesEur" | "diasTotales">, plan: Pick<Plan, "dias" | "personas">): ErrorEtapa[] {
  return validarEtapas(etapas, contextoDe(plan, ctxBase.zonas, ctxBase.modos, ctxBase.presupuestoEur));
}
