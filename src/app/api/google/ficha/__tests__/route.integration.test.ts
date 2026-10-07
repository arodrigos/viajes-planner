import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// fic-ac4: correo fijo en CORREOS_PERMITIDOS, como en los demás tests con sesión.
const EMAIL_PROPIETARIO = "ci-test-ficha@example.com";
const CLAVE_CASADA = "osm:node/9100001";
const CLAVE_SIN_COINCIDENCIA = "osm:node/9100002";

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

function peticion(cuerpo: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/google/ficha", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const lugarDe = (id: string) => ({ fuente: "osm" as const, id, url: "https://www.openstreetmap.org/node/1", nombre_fuente: "x", etiquetas: {}, resuelto_en: "2026-10-01T00:00:00Z" });

function plan(id: string): Plan {
  const parada = (pid: string, lugar?: string) => ({
    id: pid,
    franja_id: "manana",
    nombre: pid,
    descripcion: "",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "osm" as const, url: "https://www.openstreetmap.org/node/1" },
    coordenadas: { lat: 38.7, lon: -9.1 },
    ...(lugar ? { lugar: lugarDe(lugar) } : {}),
  });
  return {
    id,
    version: 1,
    destino: "Lisboa",
    personas: 2,
    dias: [
      {
        fecha: "2026-12-10",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [parada("p-casada", CLAVE_CASADA), parada("p-sin-coincidencia", CLAVE_SIN_COINCIDENCIA), parada("p-sin-lugar")],
      },
    ],
  } as Plan;
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/google/ficha (fic-ac1, fic-ac4, fic-ac6)", () => {
  const servicio = clienteDePrueba("servicio");
  const sufijo = Date.now();
  const planId = `plan-ficha-${sufijo}`;
  const planAjenoId = `plan-ficha-ajeno-${sufijo}`;
  let cookie: string;

  async function consumoUiKit(): Promise<number> {
    const { data } = await servicio.rpc("consumo_google_resumen");
    return (data as { ui_kit_hoy: number }).ui_kit_hoy;
  }

  async function sembrarTrabajo(usuarioId: string, id: string) {
    const { error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { destino_o_tipo: "Lisboa" }, estado: "completado", plan_id: id });
    if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
  }

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    cookie = await cookieDeSesion(EMAIL_PROPIETARIO);
    const ajeno = await servicio.auth.admin.createUser({ email: `ficha-ajeno-${sufijo}@ej.com`, email_confirm: true });
    if (ajeno.error || !ajeno.data.user) throw new Error(`No se pudo crear el usuario ajeno: ${ajeno.error?.message}`);

    await guardarPlan(servicio, plan(planId));
    await guardarPlan(servicio, plan(planAjenoId));
    await sembrarTrabajo(data.user.id, planId);
    await sembrarTrabajo(ajeno.data.user.id, planAjenoId);

    await servicio.from("lugares_google").upsert([
      { clave: CLAVE_CASADA, place_id: "ChIJ-prueba-1", estado: "casado", comprobado_en: new Date().toISOString() },
      { clave: CLAVE_SIN_COINCIDENCIA, place_id: null, estado: "sin-coincidencia", comprobado_en: new Date().toISOString() },
    ]);
  });

  afterAll(async () => {
    await servicio.from("trabajos").delete().in("plan_id", [planId, planAjenoId]);
    await servicio.from("planes").delete().in("id", [planId, planAjenoId]);
    await servicio.from("lugares_google").delete().in("clave", [CLAVE_CASADA, CLAVE_SIN_COINCIDENCIA]);
  });

  it("sin sesión responde 401", async () => {
    const respuesta = await POST(peticion({ planId, paradaId: "p-casada" }));
    expect(respuesta.status).toBe(401);
  });

  it("parada ajena e inexistente dan 404 con el mismo cuerpo byte a byte", async () => {
    const ajena = await POST(peticion({ planId: planAjenoId, paradaId: "p-casada" }, cookie));
    const planInexistente = await POST(peticion({ planId: "plan-que-no-existe", paradaId: "p-casada" }, cookie));
    const paradaInexistente = await POST(peticion({ planId, paradaId: "p-que-no-existe" }, cookie));
    const cuerpos = await Promise.all([ajena, planInexistente, paradaInexistente].map((r) => r.text()));
    expect([ajena.status, planInexistente.status, paradaInexistente.status]).toEqual([404, 404, 404]);
    expect(new Set(cuerpos).size).toBe(1);
  });

  it("cuerpo sin planId o paradaId responde 400", async () => {
    expect((await POST(peticion({ paradaId: "p-casada" }, cookie))).status).toBe(400);
  });

  it("parada sin lugar o sin coincidencia responde 404 sin-ficha y no gasta cupo", async () => {
    const antes = await consumoUiKit();
    for (const paradaId of ["p-sin-lugar", "p-sin-coincidencia"]) {
      const respuesta = await POST(peticion({ planId, paradaId }, cookie));
      expect(respuesta.status).toBe(404);
      expect(await respuesta.json()).toEqual({ motivo: "sin-ficha" });
    }
    expect(await consumoUiKit()).toBe(antes);
  });

  it("parada casada devuelve el place_id y reserva exactamente una carga; la clave no viaja", async () => {
    const antes = await consumoUiKit();
    const respuesta = await POST(peticion({ planId, paradaId: "p-casada" }, cookie));
    expect(respuesta.status).toBe(200);
    const texto = await respuesta.text();
    expect(JSON.parse(texto)).toEqual({ placeId: "ChIJ-prueba-1" });
    expect(texto).not.toMatch(/AIza/);
    expect(await consumoUiKit()).toBe(antes + 1);
  });

  it("obsoleto: marca el lugar para que el trabajador lo vuelva a casar, sin gastar cupo (fic-ac6)", async () => {
    const antes = await consumoUiKit();
    const respuesta = await POST(peticion({ planId, paradaId: "p-casada", obsoleto: true }, cookie));
    expect(respuesta.status).toBe(200);
    const { data } = await servicio.from("lugares_google").select("estado, place_id").eq("clave", CLAVE_CASADA).single();
    expect(data).toEqual({ estado: "obsoleto", place_id: null });
    expect(await consumoUiKit()).toBe(antes);
  });
});
