import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ESQUEMA = "viajes_planner";

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("RLS de miembros_plan (cmd-ac1)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-miembros-rls-${Date.now()}`;
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    c = await usuarioDePrueba("ci-test-comp-ajeno@example.com");
    await sembrarPlan(servicio, planId, a.usuarioId);
    await invitar(servicio, planId, b.email, a.usuarioId);
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [planId]);
  });

  // Cada petición lleva el JWT que se pasa (o la clave anónima como bearer) y el perfil del esquema.
  async function leer(bearer: string, filtro = `plan_id=eq.${planId}`) {
    return fetch(`${SUPABASE_URL}/rest/v1/miembros_plan?select=correo&${filtro}`, {
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${bearer}`, "Accept-Profile": ESQUEMA },
    });
  }

  it("la clave anónima no obtiene filas (permiso denegado)", async () => {
    const r = await leer(ANON_KEY!);
    if (r.status === 401 || r.status === 403) return;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it("un usuario sin relación ve 0 filas, el invitado la suya y el dueño las de su plan", async () => {
    expect(await (await leer(c.accessToken)).json()).toEqual([]);
    expect(await (await leer(b.accessToken)).json()).toEqual([{ correo: b.email }]);
    expect(await (await leer(a.accessToken)).json()).toEqual([{ correo: b.email }]);
  });

  it("el invitado no ve las invitaciones de otros correos aunque las pida por correo", async () => {
    const r = await leer(c.accessToken, `correo=eq.${b.email}`);
    expect(await r.json()).toEqual([]);
  });

  it("el dueño no puede escribir por REST: solo service_role escribe", async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/miembros_plan`, {
      method: "POST",
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${a.accessToken}`, "Accept-Profile": ESQUEMA, "Content-Profile": ESQUEMA, "content-type": "application/json" },
      body: JSON.stringify({ plan_id: planId, correo: c.email, invitado_por: a.usuarioId }),
    });
    expect([401, 403]).toContain(r.status);
    const { count } = await servicio.from("miembros_plan").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(1);
  });

  it("la migración activa RLS sin FORCE y es aditiva", () => {
    const sql = readFileSync(path.join(import.meta.dirname, "../../../../supabase/migrations/00000000000032_miembros_plan.sql"), "utf8");
    expect(sql).toMatch(/alter table miembros_plan enable row level security/i);
    expect(sql).not.toMatch(/force row level security/i);
  });
});
