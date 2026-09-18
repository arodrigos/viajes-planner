import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CERROJO_TTL_MIN } from "./config";

// trabajador-ac4: la exclusión la da un UPDATE atómico en Postgres
// (migración 00000000000004), no un candado de aplicación — dos ticks
// lanzados a la vez desde procesos o máquinas distintas no podrían
// compartir ningún candado que no viva en la base de datos.
export async function adquirirCerrojo(
  supabase: SupabaseClient,
  tomadoPor: string,
  ttlMin: number = CERROJO_TTL_MIN,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("adquirir_cerrojo_trabajador", {
    p_tomado_por: tomadoPor,
    p_ttl_min: ttlMin,
  });
  if (error) throw new Error(`No se pudo adquirir el cerrojo del trabajador: ${error.message}`);
  return Boolean(data);
}

export async function liberarCerrojo(supabase: SupabaseClient, tomadoPor: string): Promise<void> {
  const { error } = await supabase.rpc("liberar_cerrojo_trabajador", { p_tomado_por: tomadoPor });
  if (error) throw new Error(`No se pudo liberar el cerrojo del trabajador: ${error.message}`);
}
