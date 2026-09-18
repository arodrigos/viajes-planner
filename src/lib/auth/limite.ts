import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Sin tope de gasto monetario (respuesta de Adrián: el modelo se paga con
// la suscripción, no por token): el único grifo que hay que cerrar aquí es
// cuántos trabajos puede encolar un usuario, no cuánto cuesta hacerlo.
export async function trabajosRecientes(
  supabase: SupabaseClient,
  usuarioId: string,
  ventanaHoras: number,
): Promise<number> {
  const desde = new Date(Date.now() - ventanaHoras * 3_600_000).toISOString();
  const { count, error } = await supabase
    .from("trabajos")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", usuarioId)
    .gte("creado_en", desde);
  if (error) throw new Error(`No se pudo contar los trabajos recientes: ${error.message}`);
  return count ?? 0;
}

export async function dentroDelLimite(
  supabase: SupabaseClient,
  usuarioId: string,
  limite: number,
  ventanaHoras: number,
): Promise<boolean> {
  return (await trabajosRecientes(supabase, usuarioId, ventanaHoras)) < limite;
}
