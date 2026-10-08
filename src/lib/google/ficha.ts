import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// La parada del cliente es el id externo (el que sobrevive a una
// sustitución), así que se busca en la versión más reciente del plan.
async function claveDeLugar(supabase: SupabaseClient, planId: string, paradaId: string): Promise<{ existe: boolean; clave: string | null }> {
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .select("id")
    .eq("plan_id", planId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer la versión del plan: ${errorVersion.message}`);
  if (!version) return { existe: false, clave: null };

  const { data: parada, error } = await supabase
    .from("paradas")
    .select("lugar")
    .eq("plan_version_id", version.id)
    .eq("id_externo", paradaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la parada: ${error.message}`);
  if (!parada) return { existe: false, clave: null };
  const id = (parada.lugar as { id?: unknown } | null)?.id;
  return { existe: true, clave: typeof id === "string" && id.length > 0 ? id : null };
}

export type BusquedaFicha = { tipo: "no-encontrada" } | { tipo: "sin-ficha" } | { tipo: "casado"; clave: string; placeId: string };

export async function buscarFicha(supabase: SupabaseClient, planId: string, paradaId: string): Promise<BusquedaFicha> {
  const { existe, clave } = await claveDeLugar(supabase, planId, paradaId);
  if (!existe) return { tipo: "no-encontrada" };
  if (!clave) return { tipo: "sin-ficha" };
  const { data, error } = await supabase.from("lugares_google").select("place_id, estado").eq("clave", clave).maybeSingle();
  if (error) throw new Error(`No se pudo leer lugares_google: ${error.message}`);
  if (!data || data.estado !== "casado" || typeof data.place_id !== "string") return { tipo: "sin-ficha" };
  return { tipo: "casado", clave, placeId: data.place_id };
}

// El CHECK de la tabla exige place_id nulo fuera de «casado». Solo se toca
// una fila casada: así un doble clic no pisa un estado que el trabajador ya
// haya rehecho.
export async function marcarObsoleto(supabase: SupabaseClient, clave: string): Promise<void> {
  const { error } = await supabase.from("lugares_google").update({ estado: "obsoleto", place_id: null }).eq("clave", clave).eq("estado", "casado");
  if (error) throw new Error(`No se pudo marcar el lugar como obsoleto: ${error.message}`);
}
