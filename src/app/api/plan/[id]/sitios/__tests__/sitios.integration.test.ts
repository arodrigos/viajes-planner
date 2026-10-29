import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { DELETE, PATCH } from "../[idExterno]/manejador";
import { POST } from "../manejador";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Correo fijo en CORREOS_PERMITIDOS (ci.yml y pruebas-a-demanda.yml).
const EMAIL = "ci-test-sitios@example.com";

async function cookieDeSesion(email: string): Promise<string> {
  const servicio = clienteDePrueba("servicio");
  const generado = await servicio.auth.admin.generateLink({ type: "magiclink", email });
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

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

function parada(id: string, franja: string): Parada {
  return { id, franja_id: franja, nombre: `Sitio ${id}`, descripcion: "Descripción", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas: { lat: 37.38, lon: -5.99 } };
}

function plan(id: string): Plan {
  return { id, version: 1, destino: "Sevilla", personas: 2, dias: [{ fecha: "2026-11-07", franjas: FRANJAS, paradas: [parada("a", "manana"), parada("b", "tarde")] }] };
}

function peticion(url: string, metodo: string, cookie?: string, cuerpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
}

const ctxPlan = (id: string) => ({ params: Promise.resolve({ id }) });
const ctxSitio = (id: string, idExterno: string) => ({ params: Promise.resolve({ id, idExterno }) });

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("/api/plan/[id]/sitios (spd-ac1, spd-ac3, spd-ac4)", () => {
  const servicio = clienteDePrueba("servicio");
  let usuarioId: string;
  let cookie: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error || !data.user) {
      const { data: lista } = await servicio.auth.admin.listUsers({ perPage: 1000 });
      const existente = lista?.users.find((u) => u.email === EMAIL);
      if (!existente) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
      usuarioId = existente.id;
    } else {
      usuarioId = data.user.id;
    }
    cookie = await cookieDeSesion(EMAIL);
  });

  async function sembrar(sufijo: string, propietario = usuarioId) {
    const planId = `plan-sitios-${sufijo}-${Date.now()}`;
    await guardarPlan(servicio, plan(planId));
    const { error } = await servicio.from("trabajos").insert({ usuario_id: propietario, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId });
    if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
    return planId;
  }

  async function versiones(planId: string) {
    const { count } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    return count ?? 0;
  }

  async function paradasDelDia(planId: string) {
    const r = await recuperarPlan(servicio, planId);
    if (!r) throw new Error("no se pudo leer el plan");
    return r.dias[0].paradas;
  }

  const alta = (planId: string, cuerpo: unknown, c: string | undefined = cookie) =>
    POST(peticion(`/api/plan/${planId}/sitios`, "POST", c, cuerpo), ctxPlan(planId));

  it("201 crea la versión N+1 con el sitio propio, su nota y las demás paradas intactas", async () => {
    const planId = await sembrar("alta");
    const r = await alta(planId, { dia: 0, nombre: "Casa Fassi", nota: "Reservar a las 21:00", version_base: 1 });
    expect(r.status).toBe(201);
    const { version, id_externo } = await r.json();
    expect(version).toBe(2);
    expect(id_externo).toMatch(/^propia-[0-9a-f]{8}$/);
    expect(await versiones(planId)).toBe(2);

    const paradas = await paradasDelDia(planId);
    expect(paradas.map((p) => p.id)).toEqual(expect.arrayContaining(["a", "b", id_externo]));
    const nueva = paradas.find((p) => p.id === id_externo);
    expect(nueva).toMatchObject({ nombre: "Casa Fassi", nota: "Reservar a las 21:00", propia: true });
    expect(nueva?.coordenadas).toBeUndefined();
    expect(paradas.find((p) => p.id === "a")?.propia).toBeUndefined();
  });

  it("409 con versión desfasada y 400 con día fuera de rango o nombre inválido, sin versiones nuevas", async () => {
    const planId = await sembrar("400");
    expect((await alta(planId, { dia: 0, nombre: "Casa Fassi", version_base: 7 })).status).toBe(409);
    const dia = await alta(planId, { dia: 5, nombre: "Casa Fassi", version_base: 1 });
    expect(dia.status).toBe(400);
    expect((await dia.json()).error).toBe("Ese día no existe en el plan");
    expect((await alta(planId, { dia: 0, nombre: "x", version_base: 1 })).status).toBe(400);
    expect((await alta(planId, { dia: 0, nombre: "Casa Fassi", nota: "n".repeat(201), version_base: 1 })).status).toBe(400);
    expect(await versiones(planId)).toBe(1);
  });

  it("sin sesión 401; plan ajeno e inexistente dan el mismo 404", async () => {
    const planId = await sembrar("auth");
    expect((await alta(planId, { dia: 0, nombre: "Casa Fassi", version_base: 1 }, "")).status).toBe(401);

    const { data: ajeno, error } = await servicio.auth.admin.createUser({ email: `ajeno-sitios-${Date.now()}@example.com`, email_confirm: true });
    if (error || !ajeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${error?.message}`);
    const planAjeno = await sembrar("ajeno", ajeno.user.id);
    for (const id of [planAjeno, `plan-sitios-no-existe-${Date.now()}`]) {
      const r = await alta(id, { dia: 0, nombre: "Casa Fassi", version_base: 1 });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "no encontrado" });
    }
    expect(await versiones(planAjeno)).toBe(1);
  });

  it("PATCH corrige el nombre y deja el sitio sin resolver; DELETE lo quita; ambos crean versión", async () => {
    const planId = await sembrar("editar");
    const { id_externo } = await (await alta(planId, { dia: 0, nombre: "Casa Fasi", nota: "con nota", version_base: 1 })).json();

    const corregido = await PATCH(peticion(`/api/plan/${planId}/sitios/${id_externo}`, "PATCH", cookie, { nombre: "Casa Fassi", version_base: 2 }), ctxSitio(planId, id_externo));
    expect(corregido.status).toBe(200);
    expect((await corregido.json()).version).toBe(3);
    const tras = (await paradasDelDia(planId)).find((p) => p.id === id_externo);
    expect(tras).toMatchObject({ nombre: "Casa Fassi", nota: "con nota", propia: true });
    expect(tras?.resolucion).toBeUndefined();

    const quitado = await DELETE(peticion(`/api/plan/${planId}/sitios/${id_externo}?version_base=3`, "DELETE", cookie), ctxSitio(planId, id_externo));
    expect(quitado.status).toBe(200);
    expect((await quitado.json()).version).toBe(4);
    expect((await paradasDelDia(planId)).map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("400 al tocar una parada del modelo; ninguna versión nueva", async () => {
    const planId = await sembrar("modelo");
    const p = await PATCH(peticion(`/api/plan/${planId}/sitios/a`, "PATCH", cookie, { nombre: "Otro nombre", version_base: 1 }), ctxSitio(planId, "a"));
    expect(p.status).toBe(400);
    const d = await DELETE(peticion(`/api/plan/${planId}/sitios/a?version_base=1`, "DELETE", cookie), ctxSitio(planId, "a"));
    expect(d.status).toBe(400);
    expect(await versiones(planId)).toBe(1);
  });

  it("429 con 20 sitios sin resolver y no crea el 21", async () => {
    const planId = await sembrar("429");
    for (let version = 1; version <= 20; version++) {
      const { error } = await servicio.rpc("anadir_sitio_propio", { p_plan_id: planId, p_version_base: version, p_dia_index: 0, p_nombre: `Sitio ${version}`, p_nota: null });
      expect(error).toBeNull();
    }
    const r = await alta(planId, { dia: 0, nombre: "Uno más", version_base: 21 });
    expect(r.status).toBe(429);
    expect(await versiones(planId)).toBe(21);
  });
});
