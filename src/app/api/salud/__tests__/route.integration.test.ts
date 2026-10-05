import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/salud/route";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRON_SECRET_ORIGINAL = process.env.CRON_SECRET;
const ANTHROPIC_KEY_ORIGINAL = process.env.ANTHROPIC_API_KEY;

// esqueleto-ac1: contra Supabase real, no contra un doble — "supabase:
// activa" solo significa algo si sale de una consulta que de verdad
// podría fallar.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("GET /api/salud (esqueleto-ac1)", () => {
  const supabase = clienteDePrueba();

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
    expect(cuerpo.esquema).toBe("viajes_planner");
    expect(cuerpo.esquema_version).toBe(2);
    expect(cuerpo.modelo_acceso).toBe("suscripcion-vps1");
    expect(cuerpo.trabajador.visto_hace_seg).toBeLessThan(60);
    expect(cuerpo.secretos_faltantes).not.toContain("CRON_SECRET");
    expect(cuerpo.secretos_faltantes).not.toContain("SUPABASE_SCHEMA");
    expect(cuerpo.credenciales_modelo_en_web).toBe(false);
  });

  // bar-ac4: sin esto, "código viejo en VPS1" y "excepción que aborta el
  // barrido" eran indistinguibles desde fuera -- /api/salud solo informaba
  // del commit de Vercel, nunca del que de verdad ejecuta el trabajador.
  it("expone trabajador.commit_sha y trabajador.ultimo_resultado del último tick", async () => {
    const resultado = { ok: true, trabajos_procesados: 0, planes_mirados: 5, paradas_intentadas: 12 };
    await supabase.from("salud").insert({ origen: "trabajador-vps1", commit_sha: "c66ade5", resultado });

    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const cuerpo = await respuesta.json();

    expect(cuerpo.trabajador.commit_sha).toBe("c66ade5");
    expect(cuerpo.trabajador.ultimo_resultado).toEqual({ ...resultado, categoria: "ok" });
  });

  // cam-ac4: el error crudo puede llevar el destino del viaje.
  it("publica el último error del tick como categoría y nunca como texto", async () => {
    const resultado = {
      ok: false,
      trabajos_procesados: 0,
      planes_mirados: 1,
      paradas_intentadas: 0,
      error: "Error: Nominatim 503 al buscar Lisboa",
    };
    await supabase.from("salud").insert({ origen: "trabajador-vps1", commit_sha: "c66ade5", resultado });

    const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
    const texto = await respuesta.text();

    expect(JSON.parse(texto).trabajador.ultimo_resultado.categoria).toBe("fuente-externa");
    expect(texto).not.toContain("Lisboa");
    expect(texto).not.toContain("Nominatim 503");
  });

  // cliente-ac3(a): al borrar SUPABASE_SCHEMA del entorno, la respuesta lo
  // delata en secretos_faltantes y no revela ningún valor.
  it("sin SUPABASE_SCHEMA en el entorno, lo delata en secretos_faltantes", async () => {
    const original = process.env.SUPABASE_SCHEMA;
    delete process.env.SUPABASE_SCHEMA;
    try {
      const respuesta = await GET(new NextRequest("http://localhost/api/salud"));
      const cuerpo = await respuesta.json();
      expect(cuerpo.secretos_faltantes).toContain("SUPABASE_SCHEMA");
      expect(JSON.stringify(cuerpo)).not.toContain(SERVICE_KEY);
    } finally {
      process.env.SUPABASE_SCHEMA = original;
    }
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
