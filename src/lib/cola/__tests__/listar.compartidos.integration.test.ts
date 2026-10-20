import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { GET as listado } from "@/app/api/viajes/route";
import { GET as plan } from "@/app/api/plan/[id]/route";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("GET /api/viajes con planes compartidos (cmd-ac5)", () => {
  const servicio = clienteDePrueba("servicio");
  const sello = Date.now();
  const compartido = `plan-compartido-${sello}`;
  const propio = `plan-propio-b-${sello}`;
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let miembroId: string;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    await sembrarPlan(servicio, compartido, a.usuarioId);
    await sembrarPlan(servicio, propio, b.usuarioId);
    miembroId = await invitar(servicio, compartido, b.email, a.usuarioId);
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [compartido, propio]);
  });

  const viajesDeB = async () => {
    const r = await listado(peticion("/api/viajes", "GET", b.cookie));
    expect(r.status).toBe(200);
    return ((await r.json()).viajes as { plan_id: string; compartido: boolean }[]).filter((v) => [compartido, propio].includes(v.plan_id));
  };

  it("el invitado ve su viaje propio (compartido:false) y el compartido (compartido:true)", async () => {
    const viajes = await viajesDeB();
    expect(viajes.map((v) => [v.plan_id, v.compartido])).toEqual([[propio, false], [compartido, true]]);
  });

  it("el dueño no ve su propio viaje como compartido", async () => {
    const r = await listado(peticion("/api/viajes", "GET", a.cookie));
    const suyo = ((await r.json()).viajes as { plan_id: string; compartido: boolean }[]).find((v) => v.plan_id === compartido);
    expect(suyo?.compartido).toBe(false);
  });

  it("si el dueño quita al invitado, el viaje desaparece del listado y el plan da 404", async () => {
    await servicio.from("miembros_plan").delete().eq("id", miembroId);
    expect((await viajesDeB()).map((v) => v.plan_id)).toEqual([propio]);
    expect((await plan(peticion(`/api/plan/${compartido}`, "GET", b.cookie), contexto({ id: compartido }))).status).toBe(404);
  });

  it("si el dueño elimina el viaje, tampoco aparece para el invitado", async () => {
    await invitar(servicio, compartido, b.email, a.usuarioId);
    expect((await viajesDeB()).map((v) => v.plan_id)).toContain(compartido);
    await servicio.from("trabajos").update({ eliminado_en: new Date().toISOString() }).eq("plan_id", compartido);
    expect((await viajesDeB()).map((v) => v.plan_id)).toEqual([propio]);
    expect((await plan(peticion(`/api/plan/${compartido}`, "GET", b.cookie), contexto({ id: compartido }))).status).toBe(404);
  });
});
