import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relojReal, type Reloj } from "@/lib/lugares/limitador";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { EtapaPlan } from "@/lib/plan/tipos";
import { calcularEventos, segmentosDe, type FuenteEventos, type VersionParaEventos } from "./calcular";
import type { EventosVersion } from "./tipos";

export interface DependenciasEventos {
  fuenteEventos: FuenteEventos;
  reloj?: Reloj;
}

export interface ResultadoEventos {
  intentadas: number;
  con_eventos: number;
  fallos: number;
}

export const resultadoEventosVacio = (): ResultadoEventos => ({ intentadas: 0, con_eventos: 0, fallos: 0 });

// Un fallo de las fuentes no se reintenta en cada tick: pasada esta hora, sí.
export const ESPERA_REINTENTO_MS = 60 * 60 * 1000;

export type VersionConPlan = VersionParaEventos & { planId: string };

// El modo de fechas vive en los criterios del trabajo, no en el plan: un plan
// «de época» tiene días con fechas de relleno que no son del viaje.
async function planesConFechas(supabase: SupabaseClient, planIds: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.from("trabajos").select("plan_id, criterios").in("plan_id", planIds);
  if (error) throw new Error(`No se pudieron leer los criterios de los planes: ${error.message}`);
  const conFechas = new Set<string>();
  for (const fila of (data as Array<{ plan_id: string; criterios: { fechas?: { modo?: string } } | null }> | null) ?? []) {
    if (fila.criterios?.fechas?.modo === "fechas") conFechas.add(fila.plan_id);
  }
  return conFechas;
}

async function guardar(supabase: SupabaseClient, versionId: string, datos: EventosVersion, definitivo: boolean): Promise<void> {
  const { error } = await supabase
    .from("plan_versiones")
    .update({ eventos: datos, eventos_intentados_en: definitivo ? datos.consultado_en : null })
    .eq("id", versionId);
  if (error) throw new Error(`No se pudieron guardar los eventos: ${error.message}`);
}

// Versiones a las que aún no se han consultado los eventos. Un plan en modo
// época se marca sin hacer ninguna petición.
export async function enriquecerEventosPendientes(
  supabase: SupabaseClient,
  deps: DependenciasEventos,
  versiones: VersionConPlan[],
  limite: number,
  hasta?: number,
): Promise<ResultadoEventos> {
  const resultado = resultadoEventosVacio();
  if (versiones.length === 0) return resultado;
  const reloj = deps.reloj ?? relojReal;
  const { data, error } = await supabase
    .from("plan_versiones")
    .select("id, eventos")
    .in("id", versiones.map((v) => v.id))
    .is("eventos_intentados_en", null);
  if (error) throw new Error(`No se pudieron leer las versiones sin eventos: ${error.message}`);
  const reintentables = new Set(
    ((data as Array<{ id: string; eventos: EventosVersion | null }> | null) ?? [])
      .filter((f) => !(f.eventos?.estado === "fallo" && reloj.ahora() - Date.parse(f.eventos.consultado_en) < ESPERA_REINTENTO_MS))
      .map((f) => f.id),
  );
  const pendientes = versiones.filter((v) => reintentables.has(v.id)).slice(0, limite);
  if (pendientes.length === 0) return resultado;
  const conFechas = await planesConFechas(supabase, [...new Set(pendientes.map((v) => v.planId))]);

  for (const version of pendientes) {
    if (hasta !== undefined && reloj.ahora() >= hasta) break;
    const ahora = new Date(reloj.ahora()).toISOString();
    if (!conFechas.has(version.planId)) {
      await guardar(supabase, version.id, { estado: "epoca", consultado_en: ahora, eventos: [] }, true);
      resultado.intentadas += 1;
      continue;
    }
    const segmentos = segmentosDe(version);
    // Sin ciudad resuelta no hay a quién preguntar todavía: se deja sin marcar
    // para cuando el barrido la deduzca.
    if (segmentos.length === 0) continue;
    const { eventos, fallo } = await calcularEventos(deps.fuenteEventos, segmentos);
    await guardar(supabase, version.id, { estado: fallo ? "fallo" : "consultado", consultado_en: ahora, eventos }, !fallo);
    resultado.intentadas += 1;
    if (fallo) resultado.fallos += 1;
    if (eventos.length > 0) resultado.con_eventos += 1;
  }
  return resultado;
}

// Tras guardar un plan nuevo. Nunca lanza: los eventos no pueden tumbar un
// plan ya completado.
export async function enriquecerEventosDePlan(
  supabase: SupabaseClient,
  deps: DependenciasEventos,
  planId: string,
  presupuestoMs = 60_000,
): Promise<ResultadoEventos> {
  try {
    const { data } = await supabase
      .from("plan_versiones")
      .select("id, dias, etapas, planes(ciudad)")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1);
    const fila = data?.[0] as
      | { id: string; dias: Array<{ fecha: string }>; etapas: EtapaPlan[] | null; planes: { ciudad: CiudadEfectiva | null } | Array<{ ciudad: CiudadEfectiva | null }> | null }
      | undefined;
    if (!fila) return resultadoEventosVacio();
    const plan = Array.isArray(fila.planes) ? fila.planes[0] : fila.planes;
    const reloj = deps.reloj ?? relojReal;
    return await enriquecerEventosPendientes(
      supabase,
      deps,
      [{ id: fila.id, planId, ciudad: plan?.ciudad ?? null, dias: fila.dias, etapas: fila.etapas }],
      1,
      reloj.ahora() + presupuestoMs,
    );
  } catch {
    return resultadoEventosVacio();
  }
}
