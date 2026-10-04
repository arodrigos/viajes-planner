import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { GET } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ics-ac1: correo fijo en CORREOS_PERMITIDOS, mismo motivo que
// EMAIL_PROPIETARIO en visitas/__tests__/route.integration.test.ts -- quien
// autentica de verdad tiene que pasar la lista blanca.
const EMAIL_PROPIETARIO = "ci-test-calendario@example.com";

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
  return new NextRequest(`http://localhost/api/plan/${id}/calendario.ics`, {
    headers: cookie ? { cookie } : {},
  });
}

const DESTINO = "Toledo";

function planDeCincoParadas(id: string): Plan {
  const franjas = franjasComoArray(DESTINO);
  return {
    id,
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas,
        paradas: [
          {
            id: "parada-calendario-a",
            franja_id: franjas[0].id,
            nombre: "Catedral de Toledo",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            coordenadas: { lat: 39.8578, lon: -4.0226 },
          },
          {
            id: "parada-calendario-b",
            franja_id: franjas[1].id,
            nombre: "Mirador del Valle",
            descripcion: "Vista panorámica",
            duracion_min: 60,
            prioridad: 60,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/2" },
            coordenadas: { lat: 39.8496, lon: -4.0273 },
          },
          {
            id: "parada-calendario-c",
            franja_id: franjas[2].id,
            nombre: "Comida en el centro",
            descripcion: "Pausa para comer",
            duracion_min: 90,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
      {
        fecha: "2026-11-08",
        franjas,
        paradas: [
          {
            id: "parada-calendario-d",
            franja_id: franjas[0].id,
            nombre: "Sinagoga del Tránsito",
            descripcion: "Museo sefardí",
            duracion_min: 45,
            prioridad: 50,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/9" },
            coordenadas: { lat: 39.8541, lon: -4.0254 },
          },
          {
            id: "parada-calendario-e",
            franja_id: franjas[1].id,
            nombre: "Puente de San Martín",
            descripcion: "Paseo por el puente",
            duracion_min: 30,
            prioridad: 40,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
    ],
  };
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("GET /api/plan/[id]/calendario.ics (ics-ac1)", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookiePropietario: string;
  let planId: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);

    planId = `plan-calendario-ruta-${Date.now()}`;
    await guardarPlan(servicio, planDeCincoParadas(planId));
    const { error: errorTrabajo } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: DESTINO }, estado: "completado", plan_id: planId });
    if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo del propietario: ${errorTrabajo.message}`);
  });

  afterAll(async () => {
    await servicio.from("trabajos").delete().eq("plan_id", planId);
    await servicio.from("planes").delete().eq("id", planId);
  });

  it("sin sesión responde 401", async () => {
    const respuesta = await GET(peticion(planId), contexto(planId));
    expect(respuesta.status).toBe(401);
  });

  it("plan ajeno responde 404", async () => {
    const idAjeno = `usuario-ajeno-calendario-${Date.now()}`;
    const cookieAjena = await (async () => {
      const { error } = await servicio.auth.admin.createUser({ email: `${idAjeno}@example.com`, email_confirm: true });
      if (error) throw new Error(`No se pudo crear el usuario ajeno: ${error.message}`);
      return cookieDeSesion(`${idAjeno}@example.com`);
    })();
    const respuesta = await GET(peticion(planId, cookieAjena), contexto(planId));
    expect(respuesta.status).toBe(404);
  });

  it("descarga un calendario válido: un VEVENT por parada, GEO solo en las resueltas, cabeceras correctas", async () => {
    const respuesta = await GET(peticion(planId, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(respuesta.headers.get("content-disposition")).toBe('attachment; filename="toledo.ics"');

    const cuerpo = await respuesta.text();
    const numeroEventos = (cuerpo.match(/BEGIN:VEVENT/g) ?? []).length;
    const numeroGeo = (cuerpo.match(/^GEO:/gm) ?? []).length;
    expect(numeroEventos).toBe(5);
    expect(numeroGeo).toBe(3);
    expect(cuerpo).toMatch(/BEGIN:VCALENDAR[\s\S]*END:VCALENDAR/);
    expect(cuerpo).toContain("SUMMARY:Catedral de Toledo");
  });
});
