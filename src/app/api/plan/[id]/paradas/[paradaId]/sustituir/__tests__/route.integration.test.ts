import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { POST as sustituir } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// alt-ac6: correo fijo en CORREOS_PERMITIDOS, mismo motivo que
// EMAIL_PROPIETARIO en viajes/[id]/route.integration.test.ts -- quien
// realmente autentica tiene que pasar la lista blanca, así que no puede
// ser un correo generado con Date.now().
const EMAIL_PROPIETARIO = "ci-test-sustituir@example.com";

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

function contexto(id: string, paradaId: string) {
  return { params: Promise.resolve({ id, paradaId }) };
}

function peticion(id: string, paradaId: string, cuerpo: unknown, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/paradas/${paradaId}/sustituir`, {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

function planConAlternativa(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-sustituir-ruta-1",
            franja_id: "manana",
            nombre: "Catedral de Sevilla",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            categoria: "monumento",
            coordenadas: { lat: 37.3862, lon: -5.9926 },
            alternativas: [
              {
                nombre: "Real Alcázar",
                descripcion: "Palacio real",
                motivo: "mismo tipo, misma franja",
                duracion_min: 100,
                categoria: "monumento",
                origen: "modelo",
                coordenadas: { lat: 37.3834, lon: -5.9904 },
              },
            ],
          },
        ],
      },
    ],
  };
}

// alt-ac6: la autorización y el aislamiento de datos ajenos de este
// endpoint, probados de verdad contra la pila real (job `persistencia`):
// dos usuarios reales, los tres códigos de su cuerpo exacto, y un fetch
// global espiado para comprobar que sustituir NUNCA llama a ningún host
// externo. El test de 401 vive en route.test.ts (misma puerta de sesión
// que el resto de endpoints); aquí solo lo que necesita sesión real.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/plan/[id]/paradas/[paradaId]/sustituir (alt-ac6)", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookiePropietario: string;
  let planId: string;
  let alternativaId: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);

    planId = `plan-sustituir-ruta-${Date.now()}`;
    await guardarPlan(servicio, planConAlternativa(planId));
    const { error: errorTrabajo } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId });
    if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo del propietario: ${errorTrabajo.message}`);

    const plan = await recuperarPlan(servicio, planId);
    alternativaId = plan?.dias[0].paradas[0].alternativas?.[0].id as string;
    if (!alternativaId) throw new Error("No se sembró ninguna alternativa para el test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sesión de OTRO usuario responde 404 y no crea ninguna versión nueva", async () => {
    const emailB = `sustituir-ajeno-${Date.now()}@ej.com`;
    const { error: errorB } = await servicio.auth.admin.createUser({ email: emailB, email_confirm: true });
    if (errorB) throw new Error(`No se pudo crear el usuario B: ${errorB.message}`);
    const cookieB = await cookieDeSesion(emailB);

    const { count: versionesAntes } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);

    const respuesta = await sustituir(
      peticion(planId, "parada-sustituir-ruta-1", { alternativa_id: alternativaId }, cookieB),
      contexto(planId, "parada-sustituir-ruta-1"),
    );
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ error: "no encontrado" });

    const { count: versionesDespues } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(versionesDespues).toBe(versionesAntes);
  });

  it("un alternativa_id que no pertenece a la parada responde 400 con mensaje", async () => {
    const respuesta = await sustituir(
      peticion(planId, "parada-sustituir-ruta-1", { alternativa_id: "00000000-0000-0000-0000-000000000000" }, cookiePropietario),
      contexto(planId, "parada-sustituir-ruta-1"),
    );
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "esa alternativa no es de este plan o el plan ha cambiado; recarga" });
  });

  it("nunca llama a ningún host externo: un fetch espiado que fallaría si se invocara", async () => {
    const espia = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("sustituirParada no debe llamar a fetch: no hay modelo ni fuente externa en este camino");
    });

    const respuesta = await sustituir(
      peticion(planId, "parada-sustituir-ruta-1", { alternativa_id: alternativaId }, cookiePropietario),
      contexto(planId, "parada-sustituir-ruta-1"),
    );

    expect(respuesta.status).toBe(200);
    expect(espia).not.toHaveBeenCalled();
  });
});
