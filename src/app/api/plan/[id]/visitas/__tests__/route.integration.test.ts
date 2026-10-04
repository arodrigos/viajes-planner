import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { sustituirParada } from "@/lib/plan/sustituir";
import type { Plan } from "@/lib/plan/tipos";
import { DELETE, POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// dest-ac1/dest-ac4: correo fijo en CORREOS_PERMITIDOS, mismo motivo que
// EMAIL_PROPIETARIO en sustituir/__tests__/route.integration.test.ts.
const EMAIL_PROPIETARIO = "ci-test-destino@example.com";

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

function peticion(metodo: "POST" | "DELETE", id: string, cuerpo: unknown, cookie?: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/visitas`, {
    method: metodo,
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const DESTINO = "Toledo";

function planConDosParadas(id: string): Plan {
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
            id: "parada-destino-a",
            franja_id: franjas[0].id,
            nombre: "Catedral de Toledo",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            coordenadas: { lat: 39.8578, lon: -4.0226 },
            alternativas: [
              {
                nombre: "Alcázar de Toledo",
                descripcion: "Museo militar",
                motivo: "misma franja",
                duracion_min: 90,
                categoria: "museo",
                origen: "modelo",
                coordenadas: { lat: 39.8603, lon: -4.0231 },
              },
            ],
          },
          {
            id: "parada-destino-b",
            franja_id: franjas[1]?.id ?? franjas[0].id,
            nombre: "Mirador del Valle",
            descripcion: "Vista panorámica",
            duracion_min: 60,
            prioridad: 60,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/2" },
            coordenadas: { lat: 39.8496, lon: -4.0273 },
          },
        ],
      },
    ],
  };
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST|DELETE /api/plan/[id]/visitas (dest-ac1, dest-ac4)", () => {
  const servicio = clienteDePrueba("servicio");
  let idPropietario: string;
  let cookiePropietario: string;
  let planId: string;

  beforeAll(async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: EMAIL_PROPIETARIO, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario propietario: ${error?.message}`);
    idPropietario = data.user.id;
    cookiePropietario = await cookieDeSesion(EMAIL_PROPIETARIO);

    planId = `plan-destino-ruta-${Date.now()}`;
    await guardarPlan(servicio, planConDosParadas(planId));
    const { error: errorTrabajo } = await servicio
      .from("trabajos")
      .insert({ usuario_id: idPropietario, tipo: "generacion", criterios: { destino_o_tipo: DESTINO }, estado: "completado", plan_id: planId });
    if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo del propietario: ${errorTrabajo.message}`);
  });

  afterAll(async () => {
    await servicio.from("trabajos").delete().eq("plan_id", planId);
    await servicio.from("planes").delete().eq("id", planId);
  });

  it("sesión de OTRO usuario responde 404 y no crea ninguna fila en visitas", async () => {
    const idAjeno = `usuario-ajeno-destino-${Date.now()}`;
    const planIdAjeno = `plan-destino-ajeno-${Date.now()}`;
    const { data: usuarioAjeno, error: errorAjeno } = await servicio.auth.admin.createUser({
      email: `${idAjeno}@ej.com`,
      email_confirm: true,
    });
    if (errorAjeno || !usuarioAjeno.user) throw new Error(`No se pudo crear el usuario ajeno: ${errorAjeno?.message}`);
    await guardarPlan(servicio, planConDosParadas(planIdAjeno));
    const { error: errorTrabajoAjeno } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioAjeno.user.id, tipo: "generacion", criterios: { destino_o_tipo: DESTINO }, estado: "completado", plan_id: planIdAjeno });
    if (errorTrabajoAjeno) throw new Error(`No se pudo sembrar el trabajo ajeno: ${errorTrabajoAjeno.message}`);

    const { count: visitasAntes } = await servicio.from("visitas").select("id", { count: "exact", head: true });

    const respuesta = await POST(
      peticion("POST", planIdAjeno, { parada_id: "parada-destino-a" }, cookiePropietario),
      contexto(planIdAjeno),
    );
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ error: "no encontrado" });

    const { count: visitasDespues } = await servicio.from("visitas").select("id", { count: "exact", head: true });
    expect(visitasDespues).toBe(visitasAntes);

    await servicio.from("trabajos").delete().eq("plan_id", planIdAjeno);
    await servicio.from("planes").delete().eq("id", planIdAjeno);
  });

  it("marcar, recargar, desmarcar: la fila de visitas se crea y se borra (dest-ac1)", async () => {
    const { count: antes } = await servicio.from("visitas").select("id", { count: "exact", head: true });

    const respuestaMarcar = await POST(peticion("POST", planId, { parada_id: "parada-destino-a" }, cookiePropietario), contexto(planId));
    expect(respuestaMarcar.status).toBe(200);
    const { count: trasMarcar } = await servicio.from("visitas").select("id", { count: "exact", head: true });
    expect(trasMarcar).toBe((antes ?? 0) + 1);

    // Recargar el plan: la parada sigue marcada.
    const planTrasMarcar = await recuperarPlan(servicio, planId);
    expect(planTrasMarcar?.dias[0].paradas.find((p) => p.id === "parada-destino-a")?.visitada).toBe(true);
    expect(planTrasMarcar?.dias[0].paradas.find((p) => p.id === "parada-destino-b")?.visitada).toBeUndefined();

    // Pulsar otra vez no crea una segunda fila (idempotente).
    await POST(peticion("POST", planId, { parada_id: "parada-destino-a" }, cookiePropietario), contexto(planId));
    const { count: trasMarcarDeNuevo } = await servicio.from("visitas").select("id", { count: "exact", head: true });
    expect(trasMarcarDeNuevo).toBe(trasMarcar);

    const respuestaDesmarcar = await DELETE(peticion("DELETE", planId, { parada_id: "parada-destino-a" }, cookiePropietario), contexto(planId));
    expect(respuestaDesmarcar.status).toBe(200);
    const { count: trasDesmarcar } = await servicio.from("visitas").select("id", { count: "exact", head: true });
    expect(trasDesmarcar).toBe(antes);
  });

  // dest-ac4: marcar visitada A, sustituir B por su alternativa (nueva
  // versión del plan) y comprobar que A sigue visitada en la versión nueva.
  it("la marca de visitada sobrevive a sustituir OTRA parada del mismo día (dest-ac4)", async () => {
    const respuestaMarcar = await POST(peticion("POST", planId, { parada_id: "parada-destino-a" }, cookiePropietario), contexto(planId));
    expect(respuestaMarcar.status).toBe(200);

    const planAntes = await recuperarPlan(servicio, planId);
    const paradaA = planAntes?.dias[0].paradas.find((p) => p.id === "parada-destino-a");
    const alternativaId = paradaA?.alternativas?.[0]?.id;
    expect(alternativaId).toBeTruthy();

    const resultadoSustitucion = await sustituirParada(servicio, planId, "parada-destino-a", alternativaId as string);
    expect(resultadoSustitucion.estado).toBe("sustituida");

    const planDespues = await recuperarPlan(servicio, planId);
    expect(planDespues?.version).toBeGreaterThan(planAntes?.version ?? 0);
    expect(planDespues?.dias[0].paradas.find((p) => p.id === "parada-destino-a")?.visitada).toBe(true);

    await DELETE(peticion("DELETE", planId, { parada_id: "parada-destino-a" }, cookiePropietario), contexto(planId));
  });

  it("un parada_id que no es de este plan responde 404", async () => {
    const respuesta = await POST(peticion("POST", planId, { parada_id: "parada-que-no-existe" }, cookiePropietario), contexto(planId));
    expect(respuesta.status).toBe(404);
  });
});
