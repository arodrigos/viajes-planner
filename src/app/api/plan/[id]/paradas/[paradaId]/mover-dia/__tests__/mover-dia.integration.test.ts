import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { POST as moverDia } from "../manejador";

// arr-ac1, arr-ac3, arr-ac4: la ruta y la función 036 contra la base de prueba
// del CI. Sin SUPABASE_URL (en local) se saltan; el CI las ejecuta.
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Correo fijo en CORREOS_PERMITIDOS (ci.yml), igual que el resto de pruebas con sesión real.
const EMAIL_PROPIETARIO = "ci-test-arreglo-ruta@example.com";

async function cookieDeSesion(email: string): Promise<string> {
  const generado = await clienteDePrueba("servicio").auth.admin.generateLink({ type: "magiclink", email });
  if (generado.error) throw new Error(`No se pudo generar el enlace de prueba: ${generado.error.message}`);
  const tokenHash = generado.data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink no devolvió hashed_token");
  const jar = new Map<string, string>();
  const cliente = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(`No se pudo confirmar el enlace de prueba: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

const contexto = (id: string, paradaId: string) => ({ params: Promise.resolve({ id, paradaId }) });

function peticion(id: string, paradaId: string, cuerpo: unknown, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/paradas/${paradaId}/mover-dia`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
}

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

function parada(id: string, franja: string): Parada {
  return {
    id,
    franja_id: franja,
    nombre: `Sitio ${id}`,
    descripcion: "Descripción de prueba",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "propuesto-sin-verificar" },
    coordenadas: { lat: 37.38, lon: -5.99 },
  };
}

function planDeDosDias(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      { fecha: "2026-11-07", franjas: FRANJAS, paradas: [parada("a", "manana"), parada("b", "manana"), parada("c", "tarde")] },
      { fecha: "2026-11-08", franjas: FRANJAS, paradas: [parada("d", "manana")] },
    ],
  };
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/paradas/[paradaId]/mover-dia", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookie: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    // Un reintento del CI ya lo habrá creado: se busca y se reutiliza.
    if (error || !data.user) {
      const { data: lista } = await servicio.auth.admin.listUsers({ perPage: 1000 });
      const existente = lista?.users.find((u) => u.email === EMAIL_PROPIETARIO);
      if (!existente) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
      idPropietario = existente.id;
    } else {
      idPropietario = data.user.id;
    }
    cookie = await cookieDeSesion(EMAIL_PROPIETARIO);
  });

  async function sembrar(sufijo: string) {
    const planId = `plan-mover-${sufijo}-${Date.now()}`;
    await guardarPlan(servicio, planDeDosDias(planId));
    const { error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId });
    if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
    return planId;
  }

  async function versiones(planId: string) {
    const { count } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    return count ?? 0;
  }

  async function ids(planId: string) {
    const plan = await recuperarPlan(servicio, planId);
    return plan?.dias.map((d) => d.paradas.map((p) => `${p.id}:${p.franja_id}`));
  }

  const A_DIA_2 = { version_base: 1, dia_origen: 0, dia_destino: 1, franja_id: "manana" };

  it("sin sesión responde 401 y no crea versión", async () => {
    const planId = await sembrar("401");
    expect((await moverDia(peticion(planId, "b", A_DIA_2), contexto(planId, "b"))).status).toBe(401);
    expect(await versiones(planId)).toBe(1);
  });

  it("plan ajeno e inexistente dan el mismo 404, sin versión nueva", async () => {
    const { data: ajeno, error } = await servicio.auth.admin.createUser({ email: `ajeno-mover-${Date.now()}@ej.com`, email_confirm: true });
    if (error || !ajeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${error?.message}`);
    const planAjeno = `plan-mover-ajeno-${Date.now()}`;
    await guardarPlan(servicio, planDeDosDias(planAjeno));
    await servicio.from("trabajos").insert({ usuario_id: ajeno.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planAjeno });
    for (const id of [planAjeno, `plan-mover-no-existe-${Date.now()}`]) {
      const r = await moverDia(peticion(id, "b", A_DIA_2, cookie), contexto(id, "b"));
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "no encontrado" });
    }
    expect(await versiones(planAjeno)).toBe(1);
  });

  it("400 orden-invalido: cuerpo roto, parada inventada, día o franja inexistentes; ninguno crea versión", async () => {
    const planId = await sembrar("400");
    const casos: Array<[string, unknown]> = [
      ["b", {}],
      ["zzz", A_DIA_2],
      ["b", { ...A_DIA_2, dia_destino: 7 }],
      ["b", { ...A_DIA_2, dia_destino: 0 }],
      ["b", { ...A_DIA_2, franja_id: "noche" }],
      ["d", A_DIA_2],
    ];
    for (const [paradaId, cuerpo] of casos) {
      const r = await moverDia(peticion(planId, paradaId, cuerpo, cookie), contexto(planId, paradaId));
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect((await r.json()).error).toBe("orden-invalido");
    }
    expect(await versiones(planId)).toBe(1);
  });

  it("200 lleva la parada al final de su franja en el otro día con una versión nueva, y la inversa con posición la deja donde estaba", async () => {
    const planId = await sembrar("ok");
    const r = await moverDia(peticion(planId, "b", A_DIA_2, cookie), contexto(planId, "b"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ version: 2 });
    expect(await versiones(planId)).toBe(2);
    expect(await ids(planId)).toEqual([["a:manana", "c:tarde"], ["d:manana", "b:manana"]]);

    const vuelta = await moverDia(peticion(planId, "b", { version_base: 2, dia_origen: 1, dia_destino: 0, franja_id: "manana", posicion: 1 }, cookie), contexto(planId, "b"));
    expect(vuelta.status).toBe(200);
    expect(await ids(planId)).toEqual([["a:manana", "b:manana", "c:tarde"], ["d:manana"]]);
    expect(await versiones(planId)).toBe(3);
  });

  it("409 con la base vieja, sin otra versión", async () => {
    const planId = await sembrar("409");
    expect((await moverDia(peticion(planId, "b", A_DIA_2, cookie), contexto(planId, "b"))).status).toBe(200);
    const r = await moverDia(peticion(planId, "a", A_DIA_2, cookie), contexto(planId, "a"));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("version-desfasada");
    expect(await versiones(planId)).toBe(2);
  });
});
