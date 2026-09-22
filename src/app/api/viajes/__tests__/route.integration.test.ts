import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { GET as getViajes } from "@/app/api/viajes/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("GET /api/viajes (viajes-ac2)", () => {
  it("sin sesión responde 401 sin Set-Cookie", async () => {
    const respuesta = await getViajes(new NextRequest("http://localhost/api/viajes"));
    expect(respuesta.status).toBe(401);
    expect(respuesta.headers.getSetCookie()).toHaveLength(0);
  });

  it("con sesión de un correo fuera de la lista blanca responde 403", async () => {
    const emailAjeno = `viajes-ac2-ajeno-${Date.now()}@ej.com`;
    const servicio = clienteDePrueba("servicio");
    const { error } = await servicio.auth.admin.createUser({ email: emailAjeno, email_confirm: true });
    if (error) throw new Error(`No se pudo crear el usuario ajeno: ${error.message}`);
    const cookie = await cookieDeSesion(emailAjeno);

    const respuesta = await getViajes(new NextRequest("http://localhost/api/viajes", { headers: { cookie } }));
    expect(respuesta.status).toBe(403);
  });

  it("con sesión válida devuelve solo las filas del usuario, incluso si la query nombra a otro usuario_id", async () => {
    const emailA = "ci-test-viajes-ac2@example.com";
    const servicio = clienteDePrueba("servicio");
    const { data: creadoA, error: errorA } = await servicio.auth.admin.createUser({ email: emailA, email_confirm: true });
    if (errorA || !creadoA.user) throw new Error(`No se pudo crear el usuario A: ${errorA?.message}`);
    const idA = creadoA.user.id;

    const { data: creadoB, error: errorB } = await servicio.auth.admin.createUser({
      email: `viajes-ac2-b-${Date.now()}@ej.com`,
      email_confirm: true,
    });
    if (errorB || !creadoB.user) throw new Error(`No se pudo crear el usuario B: ${errorB?.message}`);
    const idB = creadoB.user.id;

    const { error: errorTrabajoA } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idA, tipo: "generacion", criterios: { destino_o_tipo: "Lisboa" }, estado: "completado" });
    if (errorTrabajoA) throw new Error(`No se pudo sembrar el trabajo de A: ${errorTrabajoA.message}`);
    const { error: errorTrabajoB } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idB, tipo: "generacion", criterios: { destino_o_tipo: "Roma" }, estado: "completado" });
    if (errorTrabajoB) throw new Error(`No se pudo sembrar el trabajo de B: ${errorTrabajoB.message}`);

    const cookie = await cookieDeSesion(emailA);

    const respuestaSinQuery = await getViajes(new NextRequest("http://localhost/api/viajes", { headers: { cookie } }));
    expect(respuestaSinQuery.status).toBe(200);
    const cuerpoSinQuery = await respuestaSinQuery.json();

    const respuestaConQuery = await getViajes(
      new NextRequest(`http://localhost/api/viajes?usuario_id=${idB}`, { headers: { cookie } }),
    );
    expect(respuestaConQuery.status).toBe(200);
    const cuerpoConQuery = await respuestaConQuery.json();

    // El parámetro de consulta no cambia nada: misma respuesta con o sin él.
    expect(cuerpoConQuery).toEqual(cuerpoSinQuery);
    expect(cuerpoSinQuery.correo).toBe(emailA);
    expect(cuerpoSinQuery.viajes.every((v: { id: string }) => v.id)).toBe(true);
    expect(cuerpoSinQuery.viajes.some((v: { destino: string }) => v.destino === "Roma")).toBe(false);
    expect(cuerpoSinQuery.viajes.some((v: { destino: string }) => v.destino === "Lisboa")).toBe(true);
  });
});
