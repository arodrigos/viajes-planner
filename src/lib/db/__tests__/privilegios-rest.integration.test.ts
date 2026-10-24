import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";

// grt-ac2: por la puerta real (PostgREST de la pila local) ni la clave
// anónima ni un usuario autenticado llegan a los datos del producto. Antes de
// la migración 35 esas lecturas daban 200 con 0 filas; ahora dan permiso
// denegado. Solo la clave de servicio lee.
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ESQUEMA = "viajes_planner";

describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("privilegios por REST (grt-ac2)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-privilegios-${Date.now()}`;
  let u1: UsuarioDePrueba;

  beforeAll(async () => {
    u1 = await usuarioDePrueba("ci-test-privilegios@example.com");
    await sembrarPlan(servicio, planId, u1.usuarioId);
    const { error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: u1.usuarioId, tipo: "generacion", criterios: {}, estado: "completado" });
    if (error) throw new Error(`No se pudo sembrar el trabajo de u1: ${error.message}`);
  });

  afterAll(async () => {
    await servicio.from("trabajos").delete().eq("usuario_id", u1.usuarioId);
    await limpiarPlanes(servicio, [planId]);
  });

  function cabeceras(bearer: string, extra: Record<string, string> = {}) {
    return { apikey: ANON_KEY!, Authorization: `Bearer ${bearer}`, "Accept-Profile": ESQUEMA, ...extra };
  }

  // Nunca 200 ni un array en el cuerpo: aunque venga vacío, sería leer.
  async function exigirDenegada(r: Response, etiqueta: string) {
    const cuerpo = await r.json().catch(() => null);
    expect(
      [401, 403, 404],
      `${etiqueta} respondió ${r.status}: debía denegarse (nunca 200, ni con 0 filas)`,
    ).toContain(r.status);
    expect(Array.isArray(cuerpo), `${etiqueta} devolvió un array`).toBe(false);
  }

  it.each(["planes", "plan_versiones", "paradas", "reservas"])("la clave anónima no lee %s", async (tabla) => {
    await exigirDenegada(await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=id`, { headers: cabeceras(ANON_KEY!) }), `anon ${tabla}`);
  });

  it.each(["planes", "plan_versiones", "paradas", "trabajos", "miembros_plan", "reservas"])("un usuario autenticado no lee %s", async (tabla) => {
    await exigirDenegada(await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?select=id`, { headers: cabeceras(u1.accessToken) }), `u1 ${tabla}`);
  });

  it("el dueño de un trabajo no lo lee con su propio JWT", async () => {
    await exigirDenegada(
      await fetch(`${SUPABASE_URL}/rest/v1/trabajos?select=id&usuario_id=eq.${u1.usuarioId}`, { headers: cabeceras(u1.accessToken) }),
      "u1 sus trabajos",
    );
  });

  it("la clave anónima no escribe en salud", async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/salud`, {
      method: "POST",
      headers: cabeceras(ANON_KEY!, { "Content-Profile": ESQUEMA, "content-type": "application/json" }),
      body: JSON.stringify({ origen: "x" }),
    });
    expect([401, 403, 404]).toContain(r.status);
  });

  it("anon y authenticated no ejecutan reordenar_dia_plan", async () => {
    for (const bearer of [ANON_KEY!, u1.accessToken]) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reordenar_dia_plan`, {
        method: "POST",
        headers: cabeceras(bearer, { "Content-Profile": ESQUEMA, "content-type": "application/json" }),
        body: JSON.stringify({ p_plan_id: planId, p_version_base: 1, p_dia_index: 0, p_orden: [] }),
      });
      expect(r.status).not.toBe(200);
    }
  });

  it("la clave de servicio sigue leyendo trabajos", async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/trabajos?select=id,usuario_id&usuario_id=eq.${u1.usuarioId}`, {
      headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}`, "Accept-Profile": ESQUEMA },
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as unknown[]).length).toBeGreaterThan(0);
  });
});
