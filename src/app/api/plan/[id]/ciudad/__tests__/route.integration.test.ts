import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { MENSAJE_DEMASIADO_PRONTO, POST as ciudad } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// man-ac4: correo fijo en CORREOS_PERMITIDOS, mismo motivo que
// EMAIL_PROPIETARIO en regenerar/__tests__/route.integration.test.ts.
const EMAIL_PROPIETARIO = "ci-test-ciudad@example.com";

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

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

function peticion(id: string, cuerpo: unknown, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/ciudad`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(cuerpo),
  });
}

function planMinimo(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Ciudad con niños",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-10",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-ciudad-manual-1",
            franja_id: "manana",
            nombre: "Parque central",
            descripcion: "Visita",
            duracion_min: 60,
            prioridad: 70,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
    ],
  };
}

// man-ac4: autorización y aislamiento de este endpoint, probados contra la
// pila real; el 401 vive en route.test.ts, mismo patrón que regenerar.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/ciudad (man-ac4, cp-man-03)", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookiePropietario: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);
  });

  async function sembrarPlanCompletado(sufijo: string, extra: Record<string, unknown> = {}) {
    const planId = `plan-ciudad-manual-${sufijo}-${Date.now()}`;
    await guardarPlan(servicio, planMinimo(planId));
    const { data: trabajo, error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Ciudad con niños" }, estado: "completado", plan_id: planId, ...extra })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo sembrar el trabajo del propietario: ${error?.message}`);
    return { planId, trabajoId: trabajo.id as string };
  }

  it("plan ajeno responde 404 con el mismo cuerpo que un plan inexistente, sin tocar trabajos", async () => {
    const idAjeno = `usuario-ajeno-ciudad-${Date.now()}`;
    const { data: usuarioAjeno, error: errorAjeno } = await servicio.auth.admin.createUser({ email: `${idAjeno}@ej.com`, email_confirm: true });
    if (errorAjeno || !usuarioAjeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${errorAjeno?.message}`);
    const planIdAjeno = `plan-ciudad-ajeno-${Date.now()}`;
    await guardarPlan(servicio, planMinimo(planIdAjeno));
    const { error: errorTrabajoAjeno } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioAjeno.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Ciudad con niños" }, estado: "completado", plan_id: planIdAjeno });
    if (errorTrabajoAjeno) throw new Error(`No se pudo sembrar el trabajo ajeno: ${errorTrabajoAjeno.message}`);

    const { count: trabajosAntes } = await servicio.from("trabajos").select("id", { count: "exact", head: true });

    const respuestaAjeno = await ciudad(peticion(planIdAjeno, { nombre: "Valencia" }, cookiePropietario), contexto(planIdAjeno));
    const respuestaInexistente = await ciudad(
      peticion(`plan-no-existe-${Date.now()}`, { nombre: "Valencia" }, cookiePropietario),
      contexto(`plan-no-existe-${Date.now()}`),
    );
    expect(respuestaAjeno.status).toBe(404);
    expect(respuestaInexistente.status).toBe(404);
    expect(await respuestaAjeno.json()).toEqual(await respuestaInexistente.json());
    expect(await respuestaAjeno.json()).toEqual({ error: "no encontrado" });

    const { count: trabajosDespues } = await servicio.from("trabajos").select("id", { count: "exact", head: true });
    expect(trabajosDespues).toBe(trabajosAntes);
  });

  it("plan con el trabajo marcado eliminado responde 404 igual", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("eliminado");
    const { error: errorEliminar } = await servicio.from("trabajos").update({ eliminado_en: new Date().toISOString() }).eq("id", trabajoId);
    if (errorEliminar) throw new Error(`No se pudo marcar el trabajo como eliminado: ${errorEliminar.message}`);

    const respuesta = await ciudad(peticion(planId, { nombre: "Valencia" }, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ error: "no encontrado" });
  });

  it("cuerpo sin 'nombre' responde 400, no 500", async () => {
    const { planId } = await sembrarPlanCompletado("sin-nombre");
    const respuesta = await ciudad(peticion(planId, {}, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(400);
  });

  it("primera petición 200 y escribe pendiente-manual recortado a 80; la segunda en la misma hora responde 429 sin tocar otra columna ni trabajos", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("rate-limit");
    const nombreLargo = "Valencia" + " ".repeat(5) + "x".repeat(200);

    const { data: trabajoAntes } = await servicio.from("trabajos").select("estado, regenerado_en").eq("id", trabajoId).single();

    const primera = await ciudad(peticion(planId, { nombre: nombreLargo }, cookiePropietario), contexto(planId));
    expect(primera.status).toBe(200);

    const { data: planTrasPrimera } = await servicio.from("planes").select("ciudad, destino").eq("id", planId).single();
    expect(planTrasPrimera?.destino).toBe("Ciudad con niños");
    expect(planTrasPrimera?.ciudad?.estado).toBe("pendiente-manual");
    expect(planTrasPrimera?.ciudad?.nombre_pedido).toHaveLength(80);
    expect(planTrasPrimera?.ciudad?.nombre_pedido?.startsWith("Valencia")).toBe(true);
    expect(planTrasPrimera?.ciudad?.pedido_en).toBeTruthy();

    const segunda = await ciudad(peticion(planId, { nombre: "Sevilla" }, cookiePropietario), contexto(planId));
    expect(segunda.status).toBe(429);
    expect(await segunda.json()).toEqual({ error: MENSAJE_DEMASIADO_PRONTO });

    // man-ac4/invariante: el segundo intento, rechazado, no cambió nada.
    const { data: planTrasSegunda } = await servicio.from("planes").select("ciudad, destino").eq("id", planId).single();
    expect(planTrasSegunda).toEqual(planTrasPrimera);

    const { data: trabajoDespues } = await servicio.from("trabajos").select("estado, regenerado_en").eq("id", trabajoId).single();
    expect(trabajoDespues).toEqual(trabajoAntes);
  });
});
