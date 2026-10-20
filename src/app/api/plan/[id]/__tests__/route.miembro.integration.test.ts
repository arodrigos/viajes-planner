import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { invitar, limpiarPlanes, NOTA_SEMILLA, PRECIO_SEMILLA, PRESUPUESTO_SEMILLA, sembrarPlan, ALOJAMIENTO_SEMILLA } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { GET } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PROHIBIDAS = ["presupuesto", "tu_presupuesto_eur", "alojamiento_noche_eur", "ancla_alojamiento", "trabajoId", "regenerando", "google", "coste_eur"];

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("GET /api/plan/[id] como miembro (cmd-ac3)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-miembro-get-${Date.now()}`;
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    await sembrarPlan(servicio, planId, a.usuarioId);
    await invitar(servicio, planId, b.email, a.usuarioId);
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [planId]);
  });

  const leer = (u: UsuarioDePrueba) => GET(peticion(`/api/plan/${planId}`, "GET", u.cookie), contexto({ id: planId }));

  it("el miembro recibe días y paradas completos, con nota y precio, y sin dinero, alojamiento ni estado interno", async () => {
    const r = await leer(b);
    expect(r.status).toBe(200);
    const texto = await r.text();
    for (const clave of PROHIBIDAS) expect(texto).not.toContain(`"${clave}"`);
    expect(texto).not.toContain(ALOJAMIENTO_SEMILLA);
    const cuerpo = JSON.parse(texto);
    expect(cuerpo.compartido).toEqual({ rol: "miembro" });
    const paradas = cuerpo.dias[0].paradas;
    expect(paradas.map((p: { id: string }) => p.id)).toEqual(["a", "propia-0001"]);
    expect(paradas[0].coste.importe_eur).toBe(PRECIO_SEMILLA);
    expect(paradas[1].nota).toBe(NOTA_SEMILLA);
    // La copia offline del invitado depende de esta cabecera.
    expect(r.headers.get("x-plan-leido-en")).not.toBeNull();
  });

  it("el dueño recibe lo de siempre (presupuesto, trabajoId, alojamiento) más compartidoCon", async () => {
    const cuerpo = await (await leer(a)).json();
    expect(cuerpo.presupuesto.tu_presupuesto_eur).toBe(PRESUPUESTO_SEMILLA);
    expect(cuerpo.dias[0].ancla_alojamiento).toBeDefined();
    expect(cuerpo.etapas[0].alojamiento_noche_eur).toBe(140);
    expect(cuerpo.trabajoId).toBeDefined();
    expect(cuerpo.compartido).toBeUndefined();
    expect(cuerpo.compartidoCon).toBe(1);
    expect(cuerpo.dias[0].paradas).toHaveLength(2);
  });
});
