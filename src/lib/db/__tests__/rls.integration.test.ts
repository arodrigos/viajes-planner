import { describe, expect, it } from "vitest";
import { TABLAS } from "@/lib/db/tablas";

// esquema-ac4: ninguna tabla es legible con la clave anónima a través del
// esquema propio `viajes_planner`. Contra la pila local real de Supabase
// (supabase start), no una base de datos simulada: RLS es una propiedad que
// solo demuestra Postgres de verdad. El esquema va literal aquí (no por
// SUPABASE_SCHEMA): este fichero habla con la API por fetch a propósito, sin
// pasar por la fábrica de clientes de la aplicación -esa es la superficie
// del bloque cliente-y-salud, no de este.
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ESQUEMA = "viajes_planner";

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("RLS con la clave anónima", () => {
  it.each(TABLAS)("la tabla '%s' no devuelve filas con la clave anónima", async (tabla) => {
    const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
      headers: {
        apikey: ANON_KEY as string,
        Authorization: `Bearer ${ANON_KEY}`,
        "Accept-Profile": ESQUEMA,
      },
    });
    if (respuesta.status === 401 || respuesta.status === 403) return;
    expect(respuesta.status).toBe(200);
    const filas = await respuesta.json();
    expect(filas).toEqual([]);
  });

  // esquema-ac4(b), la trampa hecha aserción: sin cabecera de perfil, la
  // petición se resuelve contra `public`, y ahí no hay ni un objeto del
  // producto. Si este caso se pusiera verde con un 200, significaría que el
  // caso anterior llevaba todo este tiempo mirando el esquema equivocado.
  it.each(TABLAS)("sin Accept-Profile, '%s' no aparece en public (404 PGRST205)", async (tabla) => {
    const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=*`, {
      headers: { apikey: ANON_KEY as string, Authorization: `Bearer ${ANON_KEY}` },
    });
    expect(respuesta.status).toBe(404);
    const cuerpo = await respuesta.json();
    expect(cuerpo.code).toBe("PGRST205");
  });
});
