import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { recuperarPlan } from "@/lib/plan/repositorio";
import { GET as getPlan } from "@/app/api/plan/[id]/route";
import { DELETE as deleteViaje } from "@/app/api/viajes/[id]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Correo fijo en CORREOS_PERMITIDOS (mismo motivo que ci-test-viajes-ac2 en
// route.integration.test.ts de /api/viajes): quien realmente autentica y
// llama al DELETE necesita pasar la lista blanca, así que no puede ser un
// correo generado con Date.now(). El "otro usuario" de cada caso sí puede
// serlo, porque nunca autentica -su fila la siembra directamente el cliente
// de servicio.
const EMAIL_PROPIETARIO = "ci-test-eliminar@example.com";

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

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("DELETE /api/viajes/[id] (borrar-ac2/ac3)", () => {
  let idPropietario: string;
  let cookiePropietario: string;

  // Se crea una sola vez: el usuario y su sesión son los mismos en los dos
  // tests que autentican, solo cambian los trabajos que siembra cada uno.
  beforeAll(async () => {
    const servicio = clienteDePrueba("servicio");
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);
  });

  it("sin sesión responde 401", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const respuesta = await deleteViaje(new NextRequest(`http://localhost/api/viajes/${id}`, { method: "DELETE" }), contexto(id));
    expect(respuesta.status).toBe(401);
  });

  it("borrar-ac3: el trabajo de otro usuario responde 404 y no marca nada", async () => {
    const servicio = clienteDePrueba("servicio");
    const emailB = `borrar-ac3-b-${Date.now()}@ej.com`;
    const { data: usuarioB, error: errorB } = await servicio.auth.admin.createUser({ email: emailB, email_confirm: true });
    if (errorB || !usuarioB.user) throw new Error(`No se pudo crear el usuario B: ${errorB?.message}`);

    const { data: trabajoB, error: errorTrabajoB } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioB.user.id, tipo: "generacion", criterios: { destino_o_tipo: "Roma" }, estado: "completado" })
      .select("id")
      .single();
    if (errorTrabajoB || !trabajoB) throw new Error(`No se pudo sembrar el trabajo de B: ${errorTrabajoB?.message}`);

    const respuesta = await deleteViaje(
      new NextRequest(`http://localhost/api/viajes/${trabajoB.id}`, { method: "DELETE", headers: { cookie: cookiePropietario } }),
      contexto(trabajoB.id),
    );
    expect(respuesta.status).toBe(404);

    const { data: filaB } = await servicio.from("trabajos").select("eliminado_en").eq("id", trabajoB.id).single();
    expect(filaB?.eliminado_en).toBeNull();
  });

  it("borrar-ac1/ac2: marca eliminado_en (no borra), y el plan del propio dueño pasa a responder 404 aunque siga recuperable en la base", async () => {
    const servicio = clienteDePrueba("servicio");

    const planId = `plan-borrar-ac2-${Date.now()}`;
    const { error: errorPlan } = await servicio.from("planes").insert({ id: planId, destino: "Sevilla" });
    if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
    const { error: errorVersion } = await servicio
      .from("plan_versiones")
      .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
    if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);

    const { data: trabajo, error: errorTrabajo } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId })
      .select("id")
      .single();
    if (errorTrabajo || !trabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo?.message}`);

    const respuestaBorrado = await deleteViaje(
      new NextRequest(`http://localhost/api/viajes/${trabajo.id}`, { method: "DELETE", headers: { cookie: cookiePropietario } }),
      contexto(trabajo.id),
    );
    expect(respuestaBorrado.status).toBe(200);

    // borrar-ac2: la fila sigue en la base, marcada -- no un delete físico.
    const { data: filaTrasBorrado } = await servicio
      .from("trabajos")
      .select("eliminado_en")
      .eq("id", trabajo.id)
      .single();
    expect(filaTrasBorrado?.eliminado_en).not.toBeNull();

    // borrar-ac2: el plan sigue existiendo completo en la base de datos.
    await expect(recuperarPlan(servicio, planId)).resolves.toMatchObject({ id: planId, destino: "Sevilla" });

    // borrar-ac1: pero ya no responde a su propio dueño (planPerteneceAUsuario
    // deja de acreditar la propiedad de un trabajo marcado como eliminado).
    const respuestaPlan = await getPlan(
      new NextRequest(`http://localhost/api/plan/${planId}`, { headers: { cookie: cookiePropietario } }),
      contexto(planId),
    );
    expect(respuestaPlan.status).toBe(404);

    // Repetir el borrado (idempotencia): sigue sin encontrar fila que marcar,
    // así que responde igual que un ajeno, sin distinguir los dos casos.
    const respuestaSegundoBorrado = await deleteViaje(
      new NextRequest(`http://localhost/api/viajes/${trabajo.id}`, { method: "DELETE", headers: { cookie: cookiePropietario } }),
      contexto(trabajo.id),
    );
    expect(respuestaSegundoBorrado.status).toBe(404);
  });
});
