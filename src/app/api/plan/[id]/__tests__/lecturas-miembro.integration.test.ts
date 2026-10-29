import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { ALOJAMIENTO_SEMILLA, invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { GET as infografia } from "../infografia.png/route";
import { GET as calendario } from "../calendario.ics/manejador";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("calendario.ics e infografía.png del miembro (cmd-ac6)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-miembro-lecturas-${Date.now()}`;
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    c = await usuarioDePrueba("ci-test-comp-ajeno@example.com");
    await sembrarPlan(servicio, planId, a.usuarioId);
    await invitar(servicio, planId, b.email, a.usuarioId);
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [planId]);
  });

  it("el .ics del miembro se descarga sin presupuesto ni alojamiento", async () => {
    const r = await calendario(peticion(`/api/plan/${planId}/calendario.ics`, "GET", b.cookie), contexto({ id: planId }));
    expect(r.status).toBe(200);
    const ics = (await r.text()).replace(/^(UID|DTSTAMP)[:;].*$/gm, "");
    expect(ics).toContain("Catedral");
    expect(ics).not.toMatch(/presupuesto|alojamiento|4000|4\.000/i);
    expect(ics).not.toContain(ALOJAMIENTO_SEMILLA);
  });

  it("la infografía del miembro es un PNG; la del ajeno, 404", async () => {
    const r = await infografia(peticion(`/api/plan/${planId}/infografia.png`, "GET", b.cookie), contexto({ id: planId }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const ajeno = await infografia(peticion(`/api/plan/${planId}/infografia.png`, "GET", c.cookie), contexto({ id: planId }));
    expect(ajeno.status).toBe(404);
  });
});
