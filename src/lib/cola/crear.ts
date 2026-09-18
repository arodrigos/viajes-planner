import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dentroDelLimite } from "@/lib/auth/limite";
import { validarCriterios } from "@/lib/criterios/validar";
import { LIMITE_TRABAJOS_POR_HORA } from "./config";

export type ResultadoCrearTrabajo =
  | { estado: "creado"; id: string }
  | { estado: "criterios-invalidos"; errores: string[] }
  | { estado: "limite-superado" };

// cola-ac1: encolar devuelve identificador al instante y el trabajo queda
// "encolado" desde ese momento — no hay nada más que esperar aquí, el
// trabajador (bloque trabajador-vps1) es quien tarda.
export async function crearTrabajoGeneracion(
  supabase: SupabaseClient,
  usuarioId: string,
  criterios: unknown,
): Promise<ResultadoCrearTrabajo> {
  const validacion = validarCriterios(criterios);
  if (!validacion.valido) {
    return { estado: "criterios-invalidos", errores: validacion.errores };
  }

  if (!(await dentroDelLimite(supabase, usuarioId, LIMITE_TRABAJOS_POR_HORA, 1))) {
    return { estado: "limite-superado" };
  }

  const { data, error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`No se pudo encolar el trabajo: ${error?.message ?? "sin fila devuelta"}`);
  }
  return { estado: "creado", id: data.id as string };
}
