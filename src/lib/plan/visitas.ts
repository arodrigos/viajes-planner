// dest-ac1/dest-ac4: marcar/desmarcar una parada como visitada y leer qué
// paradas lo están. La FK real de `visitas` es `paradas.id` (fila interna,
// una por versión), pero la marca tiene que sobrevivir a una sustitución
// -que crea una fila `paradas` nueva con el MISMO `id_externo`- así que
// toda lectura y todo borrado se hacen por (plan_id, id_externo) a través
// de CUALQUIER versión, nunca por una fila concreta.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResultadoVisita = "marcada" | "desmarcada" | "no-encontrada";

async function idsVersionesDelPlan(supabase: SupabaseClient, planId: string): Promise<string[]> {
  const { data, error } = await supabase.from("plan_versiones").select("id").eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron leer las versiones del plan: ${error.message}`);
  return (data ?? []).map((fila) => fila.id as string);
}

// Todas las filas `paradas` (de cualquier versión de este plan) cuyo
// `id_externo` es el dado -- puede haber más de una si el plan ya tuvo
// varias versiones.
async function idsParadasParaIdExterno(supabase: SupabaseClient, planId: string, idExterno: string): Promise<string[]> {
  const idsVersiones = await idsVersionesDelPlan(supabase, planId);
  if (idsVersiones.length === 0) return [];
  const { data, error } = await supabase.from("paradas").select("id").in("plan_version_id", idsVersiones).eq("id_externo", idExterno);
  if (error) throw new Error(`No se pudieron leer las paradas: ${error.message}`);
  return (data ?? []).map((fila) => fila.id as string);
}

// dest-ac1: idempotente -- pulsar dos veces no crea una segunda fila. Se
// marca sobre la fila de la versión ACTUAL (la más reciente), que es la
// única con sentido para una FK nueva; cuál de las filas ya existentes
// lleve la marca es indiferente, porque toda lectura es por id_externo.
export async function marcarVisitada(supabase: SupabaseClient, planId: string, idExterno: string): Promise<ResultadoVisita> {
  const { data: versionActual, error: errorVersion } = await supabase
    .from("plan_versiones")
    .select("id")
    .eq("plan_id", planId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer la versión actual del plan: ${errorVersion.message}`);
  if (!versionActual) return "no-encontrada";

  const { data: paradaActual, error: errorParada } = await supabase
    .from("paradas")
    .select("id")
    .eq("plan_version_id", versionActual.id)
    .eq("id_externo", idExterno)
    .maybeSingle();
  if (errorParada) throw new Error(`No se pudo leer la parada: ${errorParada.message}`);
  if (!paradaActual) return "no-encontrada";

  const idsExistentes = await idsParadasParaIdExterno(supabase, planId, idExterno);
  const { data: visitaExistente, error: errorExistente } = await supabase
    .from("visitas")
    .select("id")
    .in("parada_id", idsExistentes)
    .limit(1);
  if (errorExistente) throw new Error(`No se pudo comprobar la visita: ${errorExistente.message}`);
  if ((visitaExistente ?? []).length > 0) return "marcada";

  const { error: errorInsertar } = await supabase.from("visitas").insert({ parada_id: paradaActual.id });
  if (errorInsertar) throw new Error(`No se pudo marcar la visita: ${errorInsertar.message}`);
  return "marcada";
}

// dest-ac1: borra la marca en CUALQUIER versión -no solo la actual- para
// que una sustitución o una regeneración posteriores no dejen una fila de
// visita huérfana apuntando a una parada de una versión vieja.
export async function desmarcarVisitada(supabase: SupabaseClient, planId: string, idExterno: string): Promise<ResultadoVisita> {
  const idsParadas = await idsParadasParaIdExterno(supabase, planId, idExterno);
  if (idsParadas.length === 0) return "no-encontrada";

  const { error } = await supabase.from("visitas").delete().in("parada_id", idsParadas);
  if (error) throw new Error(`No se pudo desmarcar la visita: ${error.message}`);
  return "desmarcada";
}

// dest-ac4: el conjunto de `id_externo` visitados de un plan, a través de
// cualquier versión -- lo que repositorio.ts usa para anotar `Parada.visitada`
// al leer, sin importar en qué versión se marcó la visita.
export async function idsExternosVisitados(supabase: SupabaseClient, planId: string): Promise<Set<string>> {
  const idsVersiones = await idsVersionesDelPlan(supabase, planId);
  if (idsVersiones.length === 0) return new Set();

  const { data: paradas, error: errorParadas } = await supabase.from("paradas").select("id, id_externo").in("plan_version_id", idsVersiones);
  if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);
  const idsParadas = (paradas ?? []).map((fila) => fila.id as string);
  if (idsParadas.length === 0) return new Set();

  const { data: visitas, error: errorVisitas } = await supabase.from("visitas").select("parada_id").in("parada_id", idsParadas);
  if (errorVisitas) throw new Error(`No se pudieron leer las visitas: ${errorVisitas.message}`);
  const idsParadasVisitadas = new Set((visitas ?? []).map((fila) => fila.parada_id as string));

  const resultado = new Set<string>();
  for (const fila of paradas ?? []) {
    if (idsParadasVisitadas.has(fila.id as string)) resultado.add(fila.id_externo as string);
  }
  return resultado;
}
