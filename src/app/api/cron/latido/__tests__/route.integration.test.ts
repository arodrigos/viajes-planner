import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/latido/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRETO = "secreto-de-integracion";

// Aquí lo que se comprueba con Postgres real es el efecto del endpoint
// (autorización + fila en salud), no el BCE en sí — eso ya lo cubre
// refrescar.integration.test.ts contra la misma base de datos real. Se fija
// el fetch al BCE para no depender de la disponibilidad de un tercero en
// cada ejecución de este test concreto.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("GET /api/cron/latido con secreto correcto (latido-ac1)", () => {
  const original = process.env.CRON_SECRET;
  const fetchOriginal = global.fetch;

  beforeAll(() => {
    process.env.CRON_SECRET = SECRETO;
    global.fetch = vi.fn(async () => new Response("", { status: 503 }));
  });

  afterEach(() => {
    process.env.CRON_SECRET = original ?? SECRETO;
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it("con la cabecera Authorization correcta responde 200 y deja rastro en salud", async () => {
    const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");
    const { count: antes } = await supabase.from("salud").select("id", { count: "exact", head: true });

    const respuesta = await GET(
      new NextRequest("http://localhost/api/cron/latido", {
        headers: { authorization: `Bearer ${SECRETO}` },
      }),
    );
    expect(respuesta.status).toBe(200);

    const { count: despues } = await supabase.from("salud").select("id", { count: "exact", head: true });
    expect(despues).toBe((antes ?? 0) + 1);
  });
});
