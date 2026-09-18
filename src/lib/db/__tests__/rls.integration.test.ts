import { describe, expect, it } from "vitest";
import { TABLAS } from "@/lib/db/tablas";

// persistencia-ac2: ninguna tabla es legible con la clave anónima. Contra
// la pila local real de Supabase (supabase start), no una base de datos
// simulada: RLS es una propiedad que solo demuestra Postgres de verdad.
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("RLS con la clave anónima", () => {
  it.each(TABLAS)("la tabla '%s' no devuelve filas con la clave anónima", async (tabla) => {
    const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
      headers: { apikey: ANON_KEY as string, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (respuesta.status === 401 || respuesta.status === 403) return;
    expect(respuesta.status).toBe(200);
    const filas = await respuesta.json();
    expect(filas).toEqual([]);
  });
});
