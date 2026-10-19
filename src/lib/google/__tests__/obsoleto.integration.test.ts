import { createServerClient } from "@supabase/ssr";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { POST } from "@/app/api/google/ficha/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Correos fijos en CORREOS_PERMITIDOS de ci.yml y pruebas-a-demanda.yml.
const EMAIL_A = "ci-test-obsoleto-a@example.com";
const EMAIL_B = "ci-test-obsoleto-b@example.com";
const clave = (n: number, sufijo: number) => `osm:node/${sufijo}${n}`;

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

const peticion = (planId: string, paradaId: string, cookie: string) =>
  new NextRequest("http://localhost/api/google/ficha", {
    method: "POST",
    body: JSON.stringify({ planId, paradaId, obsoleto: true }),
    headers: { "content-type": "application/json", cookie },
  });

function plan(id: string, claves: string[]): Plan {
  const parada = (n: number, lugar: string) => ({
    id: `p-${n}`,
    franja_id: "manana",
    nombre: `p-${n}`,
    descripcion: "",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "osm" as const, url: "https://www.openstreetmap.org/node/1" },
    coordenadas: { lat: 38.7, lon: -9.1 },
    lugar: { fuente: "osm" as const, id: lugar, url: "https://www.openstreetmap.org/node/1", nombre_fuente: "x", etiquetas: {}, resuelto_en: "2026-10-01T00:00:00Z" },
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
        paradas: claves.map((c, i) => parada(i, c)),
      },
    ],
  } as Plan;
}

// service_role solo tiene select e insert sobre la tabla (la migración no da
// update ni delete), así que cada escenario usa usuarios propios y el borrado
// se hace en cascada al borrar el usuario.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("límite de marcas de obsoleto (obs-ac2, obs-ac3, obs-ac4)", () => {
  const servicio = clienteDePrueba("servicio");
  const sufijo = Date.now();
  const planA = `plan-obs-a-${sufijo}`;
  const planB = `plan-obs-b-${sufijo}`;
  const clavesA = Array.from({ length: 2 }, (_, i) => clave(i, sufijo));
  const clavesB = Array.from({ length: 6 }, (_, i) => clave(i + 10, sufijo));
  const usuariosSueltos: string[] = [];
  let cookieA: string;
  let cookieB: string;
  let idA: string;
  let idB: string;

  const casar = async (claves: string[]) => {
    const { error } = await servicio
      .from("lugares_google")
      .upsert(claves.map((c) => ({ clave: c, place_id: `ChIJ-${c}`, estado: "casado", comprobado_en: new Date().toISOString() })));
    if (error) throw new Error(error.message);
  };
  const estado = async (c: string) => (await servicio.from("lugares_google").select("estado").eq("clave", c).single()).data?.estado;
  const sembrarTrabajo = async (usuarioId: string, id: string) => {
    const { error } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { destino_o_tipo: "Lisboa" }, estado: "completado", plan_id: id });
    if (error) throw new Error(error.message);
  };
  const usuarioSuelto = async () => {
    const { data, error } = await servicio.auth.admin.createUser({ email: `obs-${sufijo}-${usuariosSueltos.length}@example.com`, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    usuariosSueltos.push(data.user.id);
    return data.user.id;
  };

  beforeAll(async () => {
    const a = await servicio.auth.admin.createUser({ email: EMAIL_A, email_confirm: true });
    const b = await servicio.auth.admin.createUser({ email: EMAIL_B, email_confirm: true });
    if (a.error || !a.data.user || b.error || !b.data.user) throw new Error("No se pudieron crear los usuarios de prueba");
    idA = a.data.user.id;
    idB = b.data.user.id;
    cookieA = await cookieDeSesion(EMAIL_A);
    cookieB = await cookieDeSesion(EMAIL_B);
    await guardarPlan(servicio, plan(planA, clavesA));
    await guardarPlan(servicio, plan(planB, clavesB));
    await sembrarTrabajo(idA, planA);
    await sembrarTrabajo(idB, planB);
  });

  afterAll(async () => {
    await servicio.from("trabajos").delete().in("plan_id", [planA, planB]);
    await servicio.from("planes").delete().in("id", [planA, planB]);
    await servicio.from("lugares_google").delete().in("clave", [...clavesA, ...clavesB]);
    for (const id of [idA, idB, ...usuariosSueltos]) await servicio.auth.admin.deleteUser(id);
  });

  it("obs-ac2: la misma terna solo marca una vez; la segunda da 429 y la fila sigue casada", async () => {
    await casar([clavesA[0]]);
    const primera = await POST(peticion(planA, "p-0", cookieA));
    expect(primera.status).toBe(200);
    expect(await estado(clavesA[0])).toBe("obsoleto");

    await casar([clavesA[0]]);
    const segunda = await POST(peticion(planA, "p-0", cookieA));
    expect(segunda.status).toBe(429);
    expect(await segunda.json()).toEqual({ motivo: "limite-obsoleto" });
    expect(segunda.headers.get("cache-control")).toBe("no-store");
    expect(await estado(clavesA[0])).toBe("casado");
  });

  it("obs-ac2: las marcas de otro día no cuentan; el día es parte de la terna", async () => {
    await casar([clavesA[1]]);
    // Cinco marcas de ayer llenarían el tope si el día no formara parte de la cuenta.
    const { error } = await servicio
      .from("marcas_obsoleto_google")
      .insert(Array.from({ length: 5 }, (_, i) => ({ usuario_id: idA, clave: `ayer-${sufijo}-${i}`, dia: "2020-01-01" })));
    expect(error).toBeNull();
    expect((await POST(peticion(planA, "p-1", cookieA))).status).toBe(200);
    expect(await estado(clavesA[1])).toBe("obsoleto");
  });

  it("obs-ac3: la sexta marca de un usuario en un día da 429 y otro usuario no se ve afectado", async () => {
    await casar(clavesB);
    const codigos: number[] = [];
    for (let i = 0; i < 6; i++) codigos.push((await POST(peticion(planB, `p-${i}`, cookieB))).status);
    expect(codigos).toEqual([200, 200, 200, 200, 200, 429]);
    expect(await estado(clavesB[5])).toBe("casado");

    await casar([clavesA[0]]);
    // A ya gastó una marca de hoy en un lugar distinto: B agotado no le afecta.
    expect((await POST(peticion(planA, "p-0", cookieA))).status).toBe(429);
    const { count } = await servicio.from("marcas_obsoleto_google").select("*", { count: "exact", head: true }).eq("usuario_id", idB);
    expect(count).toBe(5);
  });

  it("obs-ac4 (invariantes): para cualquier secuencia, ≤5 'ok' por usuario, ≤1 por terna y solo 'ok' añade fila", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 14 }), async (secuencia) => {
        const usuario = await usuarioSuelto();
        const vistos = new Set<number>();
        let oks = 0;
        for (const n of secuencia) {
          const contar = async () =>
            (await servicio.from("marcas_obsoleto_google").select("*", { count: "exact", head: true }).eq("usuario_id", usuario)).count ?? 0;
          const antes = await contar();
          const { data } = await servicio.rpc("registrar_obsoleto_google", { p_usuario: usuario, p_clave: `prop-${sufijo}-${n}` });
          const esperado = vistos.has(n) ? "repetido" : oks >= 5 ? "tope-usuario" : "ok";
          expect(data).toBe(esperado);
          expect(await contar()).toBe(antes + (data === "ok" ? 1 : 0));
          if (data === "ok") {
            vistos.add(n);
            oks++;
          }
        }
        expect(oks).toBeLessThanOrEqual(5);
      }),
      { numRuns: 6 },
    );
  });
});
