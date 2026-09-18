import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/salud/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRON_SECRET_ORIGINAL = process.env.CRON_SECRET;
const ANTHROPIC_KEY_ORIGINAL = process.env.ANTHROPIC_API_KEY;

// esqueleto-ac1: contra Supabase real, no contra un doble — "supabase:
// activa" solo significa algo si sale de una consulta que de verdad
// podría fallar.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("GET /api/salud (esqueleto-ac1)", () => {
  const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");

  beforeEach(async () => {
    process.env.CRON_SECRET = "secreto-de-prueba";
    delete process.env.ANTHROPIC_API_KEY;
    await supabase.from("salud").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });

  afterEach(() => {
    process.env.CRON_SECRET = CRON_SECRET_ORIGINAL;
    process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY_ORIGINAL;
  });

  it("lee supabase real y responde con el contrato completo del manifiesto", async () => {
    await supabase.from("salud").insert({ origen: "trabajador-vps1" });

    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const cuerpo = await respuesta.json();

    expect(cuerpo.supabase).toBe("activa");
    expect(cuerpo.esquema_version).toBe(1);
    expect(cuerpo.modelo_acceso).toBe("suscripcion-vps1");
    expect(cuerpo.trabajador.visto_hace_seg).toBeLessThan(60);
    expect(cuerpo.secretos_faltantes).not.toContain("CRON_SECRET");
    expect(cuerpo.credenciales_modelo_en_web).toBe(false);
  });

  it("sin ninguna lectura previa de trabajador-vps1, visto_hace_seg es null", async () => {
    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const cuerpo = await respuesta.json();
    expect(cuerpo.trabajador.visto_hace_seg).toBeNull();
  });

  it("sin la cabecera del cron, una petición externa no deja huella en `salud`", async () => {
    await GET(new NextRequest("http://localhost/api/salud"));
    const { count } = await supabase
      .from("salud")
      .select("id", { count: "exact", head: true })
      .eq("origen", "cron-salud");
    expect(count).toBe(0);
  });

  it("con el secreto correcto en Authorization, registra el toque del cron", async () => {
    await GET(
      new NextRequest("http://localhost/api/salud", {
        headers: { authorization: "Bearer secreto-de-prueba" },
      }),
    );
    const { count } = await supabase
      .from("salud")
      .select("id", { count: "exact", head: true })
      .eq("origen", "cron-salud");
    expect(count).toBe(1);
  });

  it("si una credencial de modelo se filtra al entorno web, lo delata", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-fuga-de-prueba";
    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const cuerpo = await respuesta.json();
    expect(cuerpo.credenciales_modelo_en_web).toBe(true);
  });
});
