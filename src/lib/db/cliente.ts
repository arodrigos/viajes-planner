import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Solo servidor y solo clave de servicio: el cliente del navegador nunca
// importa este módulo (la directiva "server-only" lo garantiza en build), y
// es la única vía de acceso a datos, RLS con denegación por defecto en todo
// lo demás.
export function clienteServicio(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno");
  }
  return createClient(url, clave, { auth: { persistSession: false } });
}
