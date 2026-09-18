import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// planes no tiene su propia columna usuario_id: la propiedad se resuelve
// por el trabajo que lo generó, la única tabla con esa columna (mismo
// criterio que trabajos/consultar.ts: false, no un error, para no
// confirmar desde otro sitio que un identificador existe).
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
    .maybeSingle();
  if (error) throw new Error(`No se pudo comprobar la propiedad del plan: ${error.message}`);
  return data !== null;
}
