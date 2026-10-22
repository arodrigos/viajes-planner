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

  // La 033 quita el SELECT de authenticated: el producto lee la tabla solo con
  // service_role, así que ni un usuario autenticado ni anon la leen por REST.
  async function exigirDenegado(bearer: string, filtro?: string) {
    const r = await leer(bearer, filtro);
    expect([401, 403]).toContain(r.status);
  }

  it("la clave anónima no obtiene filas (permiso denegado)", async () => {
    await exigirDenegado(ANON_KEY!);
  });

  it("authenticated tampoco lee la tabla, sea ajeno, invitado o dueño", async () => {
    for (const u of [c, b, a]) {
      const r = await leer(u.accessToken);
      expect([401, 403]).toContain(r.status);
    }
  });

  it("el invitado no ve las invitaciones de otros correos aunque las pida por correo", async () => {
    await exigirDenegado(c.accessToken, `correo=eq.${b.email}`);
  });

  it("service_role sigue leyendo las filas del plan", async () => {
    const { data } = await servicio.from("miembros_plan").select("correo").eq("plan_id", planId);
    expect(data).toEqual([{ correo: b.email }]);
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

  it("la 033 revoca el SELECT de authenticated y es aditiva", () => {
    const sql = readFileSync(path.join(import.meta.dirname, "../../../../supabase/migrations/00000000000033_miembros_plan_sin_select_authenticated.sql"), "utf8");
    expect(sql).toMatch(/revoke select on viajes_planner\.miembros_plan from authenticated/i);
    expect(sql).not.toMatch(/\b(drop|truncate|delete)\b/i);
  });
});
