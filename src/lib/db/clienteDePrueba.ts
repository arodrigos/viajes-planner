import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Ayudante único de los ficheros de integración que necesitan su propio
// cliente (no la fábrica de producción, cliente.ts: aquí el tipo de clave
// -servicio o anónima- lo decide cada test). Mismo motivo que la fábrica:
// sin SUPABASE_SCHEMA no hay cliente, nunca un valor por defecto `public`
// que en un proyecto compartido leería o escribiría sobre datos ajenos.
// Mismo motivo de cast que cliente.ts: SchemaName no es un literal aquí, y
// no hay tipos de Database generados que dependan de él.
export function clienteDePrueba(tipo: "servicio" | "anonimo" = "servicio"): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? "";
  const clave = tipo === "servicio" ? (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") : (process.env.SUPABASE_ANON_KEY ?? "");
  const esquema = process.env.SUPABASE_SCHEMA;
  if (!esquema) {
    throw new Error("Falta SUPABASE_SCHEMA en el entorno de test");
  }
  return createClient(url, clave, { auth: { persistSession: false }, db: { schema: esquema } }) as SupabaseClient;
}
