import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARRENDAMIENTO_MIN } from "./config";

export interface TrabajoTomado {
  id: string;
  tipo: string;
  criterios: unknown;
  plan_id: string | null;
}

// cola-ac2: dos tomas concurrentes no pueden llevarse el mismo trabajo. La
// atomicidad la da la función de Postgres tomar_siguiente_trabajo (FOR
// UPDATE SKIP LOCKED + UPDATE en la misma transacción del lado del
// servidor), no un candado a nivel de aplicación que dos procesos
// distintos no podrían compartir.
export async function tomarSiguienteTrabajo(
  supabase: SupabaseClient,
  tomadoPor: string,
  arrendamientoMin: number = ARRENDAMIENTO_MIN,
): Promise<TrabajoTomado | null> {
  const { data, error } = await supabase.rpc("tomar_siguiente_trabajo", {
    p_tomado_por: tomadoPor,
    p_arrendamiento_min: arrendamientoMin,
  });
  if (error) {
    throw new Error(`No se pudo tomar el siguiente trabajo: ${error.message}`);
  }
  const fila = Array.isArray(data) ? data[0] : data;
  return (fila as TrabajoTomado | undefined) ?? null;
}
