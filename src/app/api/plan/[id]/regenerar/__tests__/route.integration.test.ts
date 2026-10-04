import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { POST as regenerar } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// reg-ac3: correo fijo en CORREOS_PERMITIDOS, mismo motivo que
// EMAIL_PROPIETARIO en sustituir/route.integration.test.ts -- quien
// autentica de verdad tiene que pasar la lista blanca.
const EMAIL_PROPIETARIO = "ci-test-regenerar@example.com";

// Mismo patrón que cookieDeSesion en requireSesion.integration.test.ts.
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

function peticion(id: string, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/regenerar`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

function planMinimo(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Oporto",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-10",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-regenerar-ruta-1",
            franja_id: "manana",
            nombre: "Torre dos Clérigos",
            descripcion: "Mirador",
            duracion_min: 60,
            prioridad: 70,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
    ],
  };
}

// reg-ac3: autorización y aislamiento de este endpoint, probados contra la
// pila real: el 401 vive en route.test.ts (misma puerta de sesión que el
// resto de endpoints); aquí solo lo que necesita sesión real.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/regenerar (reg-ac3)", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookiePropietario: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function sembrarPlanCompletado(sufijo: string, extra: Record<string, unknown> = {}) {
    const planId = `plan-regenerar-ruta-${sufijo}-${Date.now()}`;
    await guardarPlan(servicio, planMinimo(planId));
    const { data: trabajo, error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Oporto" }, estado: "completado", plan_id: planId, ...extra })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo sembrar el trabajo del propietario: ${error?.message}`);
    return { planId, trabajoId: trabajo.id as string };
  }

  it("sesión de OTRO usuario responde 404 y no toca ninguna fila de trabajos", async () => {
    // Mismo patrón que alt-ac6 (sustituir/route.integration.test.ts): el
    // plan "ajeno" lo siembra el cliente de servicio sin que su dueño
    // llegue a iniciar sesión -un correo generado con Date.now() nunca
    // pasa CORREOS_PERMITIDOS.
    const idAjeno = `usuario-ajeno-regenerar-${Date.now()}`;
    const { data: usuarioAjeno, error: errorAjeno } = await servicio.auth.admin.createUser({ email: `${idAjeno}@ej.com`, email_confirm: true });
    if (errorAjeno || !usuarioAjeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${errorAjeno?.message}`);
    const planIdAjeno = `plan-regenerar-ajeno-${Date.now()}`;
    await guardarPlan(servicio, planMinimo(planIdAjeno));
    const { error: errorTrabajoAjeno } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioAjeno.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Oporto" }, estado: "completado", plan_id: planIdAjeno });
    if (errorTrabajoAjeno) throw new Error(`No se pudo sembrar el trabajo ajeno: ${errorTrabajoAjeno.message}`);

    const { count: trabajosAntes } = await servicio.from("trabajos").select("id", { count: "exact", head: true });

    const respuesta = await regenerar(peticion(planIdAjeno, cookiePropietario), contexto(planIdAjeno));
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ error: "no encontrado" });

    const { count: trabajosDespues } = await servicio.from("trabajos").select("id", { count: "exact", head: true });
    expect(trabajosDespues).toBe(trabajosAntes);
  });

  it("trabajo 'en-curso' responde 409 con el mensaje exacto, sin tocar la fila", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("encurso", { estado: "en-curso" });

    const respuesta = await regenerar(peticion(planId, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toEqual({ error: "Este viaje ya se está regenerando; espera a que termine" });

    const { data: fila } = await servicio.from("trabajos").select("estado, regenerado_en").eq("id", trabajoId).single();
    expect(fila?.estado).toBe("en-curso");
    expect(fila?.regenerado_en).toBeNull();
  });

  it("regenerado_en de hace menos de 60 minutos responde 429 con el mensaje exacto", async () => {
    const haceDiezMinutos = new Date(Date.now() - 10 * 60_000).toISOString();
    const { planId, trabajoId } = await sembrarPlanCompletado("reciente", { regenerado_en: haceDiezMinutos });

    const respuesta = await regenerar(peticion(planId, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(429);
    expect(await respuesta.json()).toEqual({ error: "Solo se puede regenerar un viaje una vez por hora" });

    const { data: fila } = await servicio.from("trabajos").select("regenerado_en").eq("id", trabajoId).single();
    // Postgres devuelve el timestamptz con sufijo "+00:00", no "Z" -- mismo
    // instante, otra representación; se compara por valor, no por cadena.
    expect(new Date(fila?.regenerado_en ?? "").getTime()).toBe(new Date(haceDiezMinutos).getTime());
  });

  it("trabajo elegible: 200 con trabajo_id, misma fila reencolada, sin llamar a ningún host externo", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("elegible");

    const HOSTS_TERCEROS = /nominatim\.openstreetmap\.org|overpass-api\.de|wikipedia\.org|wikimedia\.org/;
    const fetchReal = globalThis.fetch.bind(globalThis);
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation((entrada, init) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
      if (HOSTS_TERCEROS.test(url)) {
        throw new Error(`regenerarViaje no debe llamar a una fuente externa (${url}): no hay modelo ni fuente externa en este camino`);
      }
      return fetchReal(entrada, init);
    });

    const { count: trabajosAntes } = await servicio.from("trabajos").select("id", { count: "exact", head: true });

    const respuesta = await regenerar(peticion(planId, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ trabajo_id: trabajoId });

    const { count: trabajosDespues } = await servicio.from("trabajos").select("id", { count: "exact", head: true });
    expect(trabajosDespues).toBe(trabajosAntes);

    const { data: fila } = await servicio.from("trabajos").select("estado, plan_id, regenerado_en").eq("id", trabajoId).single();
    expect(fila?.estado).toBe("encolado");
    expect(fila?.plan_id).toBe(planId);
    expect(fila?.regenerado_en).not.toBeNull();

    const llamadasATerceros = espia.mock.calls.filter(([entrada]) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : (entrada as Request).url;
      return HOSTS_TERCEROS.test(url);
    });
    expect(llamadasATerceros).toHaveLength(0);
  });
});
