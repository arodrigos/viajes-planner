import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trabajoDelPlan } from "@/lib/plan/propiedad";

export type ResultadoRegenerar =
  | { estado: "regenerado"; trabajoId: string }
  | { estado: "no-encontrado" }
  | { estado: "en-curso" }
  | { estado: "demasiado-pronto" };

// reg-ac3: estos tres son "en vuelo" -ya hay una generación de este plan
// trabajando o esperando su turno-, nunca dos generaciones del mismo plan a
// la vez.
const ESTADOS_EN_VUELO = ["encolado", "en-curso", "pausado-por-cuota"];

const MINUTOS_MINIMOS_ENTRE_REGENERACIONES = 60;

// reg-ac2: NO se crea un trabajo nuevo -se reencola el MISMO, conservando
// su plan_id y sus criterios- porque planPerteneceAUsuario (.maybeSingle()
// sobre trabajos por plan_id+usuario_id) y «Mis viajes» (una entrada por
// trabajo) asumen un único trabajo por plan; un segundo lo rompería a
// ambos. tomarSiguienteTrabajo ya toma cualquier estado no terminal y
// procesarTrabajo ya respeta trabajo.plan_id -el trabajador no necesita
// ningún cambio para esto.
export async function regenerarViaje(supabase: SupabaseClient, planId: string, usuarioId: string): Promise<ResultadoRegenerar> {
  const trabajo = await trabajoDelPlan(supabase, planId, usuarioId);
  if (!trabajo) return { estado: "no-encontrado" };

  if (ESTADOS_EN_VUELO.includes(trabajo.estado)) return { estado: "en-curso" };

  if (trabajo.regenerado_en) {
    const minutosDesde = (Date.now() - new Date(trabajo.regenerado_en).getTime()) / 60_000;
    if (minutosDesde < MINUTOS_MINIMOS_ENTRE_REGENERACIONES) return { estado: "demasiado-pronto" };
  }

  const ahora = new Date().toISOString();
  const { error } = await supabase
    .from("trabajos")
    .update({
      estado: "encolado",
      etapa: null,
      motivo: null,
      reintento_no_antes_de: null,
      tomado_por: null,
      tomado_hasta: null,
      regenerado_en: ahora,
      actualizado_en: ahora,
    })
    .eq("id", trabajo.id);
  if (error) throw new Error(`No se pudo reencolar el trabajo para regenerar el viaje: ${error.message}`);

  return { estado: "regenerado", trabajoId: trabajo.id };
}
