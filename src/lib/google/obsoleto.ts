import type { SupabaseClient } from "@supabase/supabase-js";

export type ResultadoObsoleto = "ok" | "repetido" | "tope-usuario" | "error";

const RESULTADOS_DE_LA_FUNCION: ReadonlySet<string> = new Set(["ok", "repetido", "tope-usuario"]);

// Cerrado ante el fallo: si la función no responde o devuelve algo inesperado
// no se marca nada, porque sin contador no hay forma de saber si el usuario
// ya gastó su límite (#240).
export async function registrarObsoleto(supabase: SupabaseClient, usuario: string, clave: string): Promise<ResultadoObsoleto> {
  try {
    const { data, error } = await supabase.rpc("registrar_obsoleto_google", { p_usuario: usuario, p_clave: clave });
    if (error) return "error";
    return typeof data === "string" && RESULTADOS_DE_LA_FUNCION.has(data) ? (data as ResultadoObsoleto) : "error";
  } catch {
    return "error";
  }
}
