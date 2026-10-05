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
const EMAIL = "ci-test-infografia@example.com";

// Mismo patrón que cookieDeSesion de calendario.ics/__tests__.
async function cookieDeSesion(email: string): Promise<string> {
  const generado = await clienteDePrueba("servicio").auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = generado.data.properties?.hashed_token;
  if (generado.error || !tokenHash) throw new Error("No se pudo generar el enlace de prueba");
  const jar = new Map<string, string>();
  const cliente = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (c) => c.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(`No se pudo confirmar el enlace de prueba: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

const contexto = (id: string) => ({ params: Promise.resolve({ id }) });
const peticion = (id: string, cookie?: string) => new NextRequest(`http://localhost/api/plan/${id}/infografia.png`, { headers: cookie ? { cookie } : {} });

function plan(id: string): Plan {
  const franjas = franjasComoArray("Toledo");
  return {
    id, version: 1, destino: "Toledo", personas: 2,
    dias: [{ fecha: "2027-03-05", franjas, paradas: [{ id: `${id}-a`, franja_id: franjas[0].id, nombre: "Catedral", descripcion: "Visita", duracion_min: 90, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" } }] }],
  };
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("GET /api/plan/[id]/infografia.png (inf-ac1)", () => {
  const servicio = clienteDePrueba("servicio");
  const sello = Date.now();
  const planPropio = `plan-infografia-${sello}`;
  const planAjeno = `plan-infografia-ajeno-${sello}`;
  let cookie: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    cookie = await cookieDeSesion(EMAIL);
    await guardarPlan(servicio, plan(planPropio));
    await servicio.from("trabajos").insert({ usuario_id: data.user.id, tipo: "generacion", criterios: { presupuesto_eur: 800 }, estado: "completado", plan_id: planPropio });

    const ajeno = await servicio.auth.admin.createUser({ email: `ajeno-infografia-${sello}@ej.com`, email_confirm: true });
    await guardarPlan(servicio, plan(planAjeno));
    await servicio.from("trabajos").insert({ usuario_id: ajeno.data.user?.id, tipo: "generacion", criterios: { presupuesto_eur: 800 }, estado: "completado", plan_id: planAjeno });
  });

  afterAll(async () => {
    for (const id of [planPropio, planAjeno]) {
      await servicio.from("trabajos").delete().eq("plan_id", id);
      await servicio.from("planes").delete().eq("id", id);
    }
  });

  it("sin sesión responde 401 sin Set-Cookie", async () => {
    const respuesta = await GET(peticion(planPropio), contexto(planPropio));
    expect(respuesta.status).toBe(401);
    expect(respuesta.headers.get("set-cookie")).toBeNull();
  });

  it("el dueño recibe un PNG de 1080×1350, privado y sin caché", async () => {
    const respuesta = await GET(peticion(planPropio, cookie), contexto(planPropio));
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("content-type")).toBe("image/png");
    expect(respuesta.headers.get("cache-control")).toMatch(/private/);
    expect(respuesta.headers.get("cache-control")).toMatch(/no-store/);
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(1350);
    expect(bytes.length).toBeGreaterThan(20 * 1024);
    expect(bytes.length).toBeLessThan(500 * 1024);
  });

  it("plan ajeno e inexistente responden 404 con el mismo cuerpo", async () => {
    const ajeno = await GET(peticion(planAjeno, cookie), contexto(planAjeno));
    const inexistente = await GET(peticion("no-existe", cookie), contexto("no-existe"));
    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await ajeno.text()).toBe(await inexistente.text());
  });
});
