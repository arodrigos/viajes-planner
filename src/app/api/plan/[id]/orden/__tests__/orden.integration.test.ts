import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { MAX_CAMBIOS_POR_HORA, POST as orden } from "../route";

// orc-ac2: la ruta usa el cliente real salvo en la RPC, que se dobla solo
// cuando la prueba lo pide con `rpcForzada`.
const doble = vi.hoisted(() => ({ rpcForzada: null as null | { code: string; message: string } }));
vi.mock("@/lib/db/cliente", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db/cliente")>();
  return {
    ...original,
    clienteServicio: () => {
      const real = original.clienteServicio();
      return new Proxy(real, {
        get: (destino, propiedad) =>
          propiedad === "rpc" && doble.rpcForzada
            ? async () => ({ data: null, error: doble.rpcForzada })
            : Reflect.get(destino, propiedad, destino),
      });
    },
  };
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// reo-ac6: correo fijo en CORREOS_PERMITIDOS (ci.yml), igual que el resto de
// pruebas con sesión real.
const EMAIL_PROPIETARIO = "ci-test-orden@example.com";

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

const contexto = (id: string) => ({ params: Promise.resolve({ id }) });

function peticion(id: string, cuerpo: unknown, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/orden`, {
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

function planDeTres(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [{ fecha: "2026-11-07", franjas: FRANJAS, paradas: [parada("a", "manana"), parada("b", "manana"), parada("c", "tarde")] }],
  };
}

const ORDEN_BA = [
  { id: "b", franja_id: "manana" },
  { id: "a", franja_id: "manana" },
  { id: "c", franja_id: "tarde" },
];
const ORDEN_AB = [
  { id: "a", franja_id: "manana" },
  { id: "b", franja_id: "manana" },
  { id: "c", franja_id: "tarde" },
];

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/orden (reo-ac6)", () => {
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

  async function sembrar(sufijo: string, extra: Record<string, unknown> = {}) {
    const planId = `plan-orden-${sufijo}-${Date.now()}`;
    await guardarPlan(servicio, planDeTres(planId));
    const { data: trabajo, error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId, ...extra })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo sembrar el trabajo: ${error?.message}`);
    return { planId, trabajoId: trabajo.id as string };
  }

  async function versiones(planId: string) {
    const { count } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    return count ?? 0;
  }

  it("sin sesión responde 401 y no crea versión", async () => {
    const { planId } = await sembrar("401");
    const respuesta = await orden(peticion(planId, { version_base: 1, dia_index: 0, orden: ORDEN_BA }), contexto(planId));
    expect(respuesta.status).toBe(401);
    expect(await versiones(planId)).toBe(1);
  });

  it("plan ajeno, inexistente y eliminado dan el mismo 404, sin versiones nuevas", async () => {
    const { data: ajeno, error } = await servicio.auth.admin.createUser({ email: `ajeno-orden-${Date.now()}@ej.com`, email_confirm: true });
    if (error || !ajeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${error?.message}`);
    const planAjeno = `plan-orden-ajeno-${Date.now()}`;
    await guardarPlan(servicio, planDeTres(planAjeno));
    await servicio.from("trabajos").insert({ usuario_id: ajeno.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planAjeno });
    const { planId: planEliminado, trabajoId } = await sembrar("eliminado");
    await servicio.from("trabajos").update({ eliminado_en: new Date().toISOString() }).eq("id", trabajoId);

    const cuerpo = { version_base: 1, dia_index: 0, orden: ORDEN_BA };
    const inexistente = `plan-orden-no-existe-${Date.now()}`;
    const respuestas = await Promise.all(
      [planAjeno, inexistente, planEliminado].map((id) => orden(peticion(id, cuerpo, cookie), contexto(id))),
    );
    for (const r of respuestas) {
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "no encontrado" });
    }
    expect(await versiones(planAjeno)).toBe(1);
    expect(await versiones(planEliminado)).toBe(1);
  });

  it("400 orden-invalido: cuerpo roto, parada inventada, repetida o franja que retrocede; ninguna crea versión", async () => {
    const { planId } = await sembrar("400");
    const invalidos: unknown[] = [
      {},
      { version_base: 1, dia_index: 0, orden: [] },
      { version_base: 1, dia_index: 7, orden: ORDEN_BA },
      { version_base: 1, dia_index: 0, orden: [{ id: "zzz", franja_id: "manana" }, ...ORDEN_BA.slice(1)] },
      { version_base: 1, dia_index: 0, orden: [ORDEN_BA[0], ORDEN_BA[0], ORDEN_BA[2]] },
      { version_base: 1, dia_index: 0, orden: [ORDEN_BA[2], ORDEN_BA[0], ORDEN_BA[1]] },
    ];
    for (const cuerpo of invalidos) {
      const r = await orden(peticion(planId, cuerpo, cookie), contexto(planId));
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("orden-invalido");
    }
    expect(await versiones(planId)).toBe(1);
  });

  it("200 crea la versión N+1 con el orden pedido; repetir con la base vieja da 409 sin otra versión", async () => {
    const { planId } = await sembrar("ok");
    const r = await orden(peticion(planId, { version_base: 1, dia_index: 0, orden: ORDEN_BA }, cookie), contexto(planId));
    expect(r.status).toBe(200);
    const { plan } = await r.json();
    expect(plan.version).toBe(2);
    expect(plan.dias[0].paradas.map((p: { id: string }) => p.id)).toEqual(["b", "a", "c"]);
    expect(await versiones(planId)).toBe(2);

    const desfasada = await orden(peticion(planId, { version_base: 1, dia_index: 0, orden: ORDEN_AB }, cookie), contexto(planId));
    expect(desfasada.status).toBe(409);
    expect((await desfasada.json()).error).toBe("version-desfasada");
    expect(await versiones(planId)).toBe(2);
  });

  it("orc-ac2: un error 23505 de la RPC es un 409 version-desfasada y no deja versión nueva", async () => {
    const { planId } = await sembrar("23505");
    doble.rpcForzada = { code: "23505", message: 'duplicate key value violates unique constraint "plan_versiones_plan_id_version_key"' };
    try {
      const r = await orden(peticion(planId, { version_base: 1, dia_index: 0, orden: ORDEN_BA }, cookie), contexto(planId));
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({
        error: "version-desfasada",
        mensaje: "El plan se acaba de actualizar mientras guardabas. Hemos cargado la versión más reciente; vuelve a ordenar si lo necesitas.",
      });
    } finally {
      doble.rpcForzada = null;
    }
    expect(await versiones(planId)).toBe(1);
  });

  it("429 al llegar a 30 versiones en la última hora, sin crear la 31", async () => {
    const { planId } = await sembrar("429");
    // La versión 1 cuenta: 29 reordenaciones más llegan al tope.
    for (let version = 1; version < MAX_CAMBIOS_POR_HORA; version++) {
      const { error } = await servicio.rpc("reordenar_dia_plan", {
        p_plan_id: planId,
        p_version_base: version,
        p_dia_index: 0,
        p_orden: version % 2 === 1 ? ORDEN_BA : ORDEN_AB,
      });
      expect(error).toBeNull();
    }
    expect(await versiones(planId)).toBe(MAX_CAMBIOS_POR_HORA);

    const r = await orden(peticion(planId, { version_base: MAX_CAMBIOS_POR_HORA, dia_index: 0, orden: ORDEN_AB }, cookie), contexto(planId));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("demasiados-cambios");
    expect(await versiones(planId)).toBe(MAX_CAMBIOS_POR_HORA);
  });
});
