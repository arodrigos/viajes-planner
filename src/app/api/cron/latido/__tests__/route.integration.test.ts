import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/latido/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRETO = "secreto-de-integracion";

// Aquí lo que se comprueba con Postgres real es el efecto del endpoint
// (autorización + fila en salud), no el BCE en sí — eso ya lo cubre
// refrescar.integration.test.ts contra la misma base de datos real, con el
// fetch al BCE fijado ahí donde SÍ se puede aislar sin arrastrar también
// las llamadas del cliente de Supabase (que usan el mismo fetch global:
// sustituirlo aquí rompía silenciosamente las propias consultas del test,
// visto contra CI real). El endpoint responde 200 pase lo que pase con el
// BCE, así que dejarlo pegar a la red real de verdad no cambia lo que se
// comprueba, solo añade unos segundos.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("GET /api/cron/latido con secreto correcto (latido-ac1)", () => {
  const original = process.env.CRON_SECRET;

  beforeAll(() => {
    process.env.CRON_SECRET = SECRETO;
  });

  afterEach(() => {
    process.env.CRON_SECRET = original ?? SECRETO;
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
