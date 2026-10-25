import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";

const guardarGasto = vi.fn();

vi.mock("@/lib/reservas/ruta", () => ({ comoDuenyo: async () => ({}), respuestaFallo: () => new Response(null, { status: 500 }) }));
vi.mock("@/lib/plan/repositorio", () => ({ recuperarPlan: async () => ({ dias: [{ fecha: "2027-03-05" }, { fecha: "2027-03-06" }] }) }));
vi.mock("@/lib/gastos/repositorio", () => ({
  contarGastos: async () => 0,
  existeGastoEnPlan: async () => false,
  guardarGasto: (...args: unknown[]) => guardarGasto(...args),
  borrarGasto: vi.fn(),
  GastoDeOtroPlan: class extends Error {},
}));

import { PUT } from "../route";

const GASTO_ID = "00000000-0000-4000-8000-000000000001";
const poner = (cuerpo: object) =>
  PUT(new NextRequest(`http://localhost/api/plan/p/gastos/${GASTO_ID}`, { method: "PUT", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: "p", gastoId: GASTO_ID }),
  });
const ENTRADAS = { importe_centimos: 1200, categoria: "entradas", actualizado_cliente: "2027-01-01T10:00:00.000Z" };

describe("PUT /api/plan/[id]/gastos/[gastoId]: solo días del viaje (gas-ac2)", () => {
  beforeEach(() => guardarGasto.mockReset());

  it("una fecha fuera del viaje da 400 con el texto del formulario y no se guarda", async () => {
    const r = await poner({ ...ENTRADAS, fecha: "2030-01-01" });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: E.fecha, errores: { fecha: E.fecha } });
    expect(guardarGasto).not.toHaveBeenCalled();
  });

  it("un día del viaje se guarda, y un transporte sin día también", async () => {
    expect((await poner({ ...ENTRADAS, fecha: "2027-03-06" })).status).toBe(200);
    expect((await poner({ ...ENTRADAS, categoria: "transporte", fecha: null })).status).toBe(200);
    expect(guardarGasto).toHaveBeenCalledTimes(2);
  });
});
