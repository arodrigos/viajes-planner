import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// planes no tiene su propia columna usuario_id: la propiedad se resuelve
// por el trabajo que lo generó, la única tabla con esa columna (mismo
// criterio que trabajos/consultar.ts: false, no un error, para no
// confirmar desde otro sitio que un identificador existe).
//
// borrar-ac1: un trabajo eliminado (marcado) deja de acreditar la propiedad
// de su plan, así que el plan pasa a responder 404 a su propio dueño -uno
// de los tres sitios que el borrado marcado obliga a filtrar, junto a
// listarViajes y obtenerTrabajo.
export async function planPerteneceAUsuario(
  supabase: SupabaseClient,
  planId: string,
  usuarioId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id")
    .eq("plan_id", planId)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo comprobar la propiedad del plan: ${error.message}`);
  return data !== null;
}
