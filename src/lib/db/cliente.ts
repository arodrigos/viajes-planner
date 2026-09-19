import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Único punto de construcción de clientes de producción: las dos fábricas
// leen SUPABASE_SCHEMA y lo pasan como `db.schema`, que es lo que hace que
// supabase-js mande `Accept-Profile` en lecturas y `Content-Profile` en
// escrituras y en `.rpc()` sin que ningún punto de llamada tenga que
// acordarse. Sin la variable, lanza: no hay valor por defecto `public`,
// porque en un proyecto compartido con el resto de la flota ese fallback
// silencioso leería o escribiría sobre datos ajenos.
function esquema(): string {
  const valor = process.env.SUPABASE_SCHEMA;
  if (!valor) {
    throw new Error("Falta SUPABASE_SCHEMA en el entorno");
  }
  return valor;
}

// Solo servidor y solo clave de servicio: el cliente del navegador nunca
// importa este módulo (la directiva "server-only" lo garantiza en build), y
// es la única vía de acceso a datos, RLS con denegación por defecto en todo
// lo demás.
// El esquema es un `string` en tiempo de ejecución (leído de env), no un
// literal, así que supabase-js infiere SchemaName = string y no encaja con
// el `SupabaseClient` (SchemaName "public" por defecto) que ya usan como
// tipo de parámetro las funciones de src/lib/*. No hay tipos generados de
// Database en este repo (Database = any en todo el árbol), así que el
// literal de esquema no aporta ninguna comprobación real sobre columnas o
// RPCs: el cast documenta esa ausencia en vez de propagar el desajuste a
// cada función que recibe un cliente.
export function clienteServicio(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno");
  }
  return createClient(url, clave, { auth: { persistSession: false }, db: { schema: esquema() } }) as SupabaseClient;
}

// Cliente anónimo del enlace mágico: hasta ahora se construía suelto en
// src/app/api/acceso/solicitar-enlace/route.ts, fuera de esta fábrica.
export function clienteAnonimo(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_ANON_KEY;
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");
  }
  return createClient(url, clave, { db: { schema: esquema() } }) as SupabaseClient;
}
