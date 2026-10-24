import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compararGasto } from "../comparar";
import { CATEGORIAS_GASTO, type Gasto } from "../tipos";

const FECHAS = ["2027-03-05", "2027-03-06", "2027-03-07"];
const PRESUPUESTO = { por_dia: FECHAS.map((fecha) => ({ fecha, total_eur: 80 })), alojamiento_eur: 500, total_eur: 800 };
const gasto = (p: Partial<Gasto>): Gasto => ({ id: "g", importe_centimos: 100, fecha: null, categoria: "transporte", actualizado_cliente: "2027-01-01T00:00:00.000Z", ...p });

describe("compararGasto (gas-ac3)", () => {
  it("un hotel de 600 € no pone ningún día en rojo y se compara con el alojamiento estimado", () => {
    const r = compararGasto(
      PRESUPUESTO,
      [gasto({ categoria: "alojamiento", importe_centimos: 60000 }), gasto({ categoria: "comida", fecha: FECHAS[0], importe_centimos: 3000 }), gasto({ categoria: "transporte", importe_centimos: 4000 })],
      FECHAS,
    );
    expect(r.por_dia[0]).toMatchObject({ gastado_c: 3000, pasado: false });
    expect(r.por_dia.some((d) => d.pasado)).toBe(false);
    expect(r.alojamiento).toEqual({ estimado_c: 50000, gastado_c: 60000 });
    expect(r.sin_dia_c).toBe(4000);
    expect(r.total).toEqual({ estimado_c: 80000, gastado_c: 67000, queda_c: 13000 });
  });

  it("sin gastos queda todo y ningún día está pasado", () => {
    const r = compararGasto(PRESUPUESTO, [], FECHAS);
    expect(r.total.queda_c).toBe(80000);
    expect(r.por_dia.some((d) => d.pasado)).toBe(false);
  });

  it("un transporte de 90 € en el día 2 lo pone en pasado y no toca sin_dia_c", () => {
    const r = compararGasto(PRESUPUESTO, [gasto({ fecha: FECHAS[1], importe_centimos: 9000 })], FECHAS);
    expect(r.por_dia[1].pasado).toBe(true);
    expect(r.sin_dia_c).toBe(0);
  });

  it("un día que ya no es del viaje se cuenta como «Todo el viaje»", () => {
    const r = compararGasto(PRESUPUESTO, [gasto({ categoria: "comida", fecha: "2030-01-01", importe_centimos: 500 })], FECHAS);
    expect(r.sin_dia_c).toBe(500);
    expect(r.total.gastado_c).toBe(500);
  });
});

const gastoArb = fc.record({
  id: fc.uuid(),
  importe_centimos: fc.integer({ min: 1, max: 10_000_000 }),
  categoria: fc.constantFrom(...CATEGORIAS_GASTO),
  fecha: fc.option(fc.constantFrom(...FECHAS, "2031-01-01"), { nil: null }),
  actualizado_cliente: fc.constant("2027-01-01T00:00:00.000Z"),
}) as fc.Arbitrary<Gasto>;
const sinOrden = (g: Gasto[]) => g.map((x) => ({ ...x, fecha: x.categoria === "alojamiento" ? null : x.fecha }));

describe("compararGasto: invariantes", () => {
  it("el total es la suma de las partes y queda = estimado − gastado", () => {
    fc.assert(
      fc.property(fc.array(gastoArb, { maxLength: 30 }), (gs) => {
        const r = compararGasto(PRESUPUESTO, sinOrden(gs), FECHAS);
        const partes = r.por_dia.reduce((s, d) => s + d.gastado_c, 0) + r.sin_dia_c + r.alojamiento.gastado_c;
        expect(r.total.gastado_c).toBe(partes);
        expect(r.total.queda_c).toBe(r.total.estimado_c - r.total.gastado_c);
      }),
    );
  });

  it("el alojamiento no suma a ningún día ni a sin_dia; comida y entradas suman a su día; transporte sin día solo a sin_dia", () => {
    fc.assert(
      fc.property(fc.array(gastoArb, { maxLength: 30 }), (gs) => {
        const limpios = sinOrden(gs).filter((g) => g.categoria !== "transporte" || g.fecha === null || FECHAS.includes(g.fecha)).map((g) => (g.categoria !== "alojamiento" && g.categoria !== "transporte" && !FECHAS.includes(g.fecha ?? "") ? { ...g, fecha: FECHAS[0] } : g));
        const r = compararGasto(PRESUPUESTO, limpios, FECHAS);
        const suma = (f: (g: Gasto) => boolean) => limpios.filter(f).reduce((s, g) => s + g.importe_centimos, 0);
        expect(r.alojamiento.gastado_c).toBe(suma((g) => g.categoria === "alojamiento"));
        expect(r.sin_dia_c).toBe(suma((g) => g.categoria === "transporte" && g.fecha === null));
        for (const d of r.por_dia) expect(d.gastado_c).toBe(suma((g) => g.categoria !== "alojamiento" && g.fecha === d.fecha));
      }),
    );
  });

  it("no depende del orden y un día está pasado si y solo si gastado > estimado", () => {
    fc.assert(
      fc.property(fc.array(gastoArb, { maxLength: 20 }), fc.nat(), (gs, giro) => {
        const l = sinOrden(gs);
        const k = l.length === 0 ? 0 : giro % l.length;
        const permutada = [...l.slice(k), ...l.slice(0, k)].reverse();
        const a = compararGasto(PRESUPUESTO, l, FECHAS);
        expect(compararGasto(PRESUPUESTO, permutada, FECHAS)).toEqual(a);
        for (const d of a.por_dia) expect(d.pasado).toBe(d.gastado_c > d.estimado_c);
      }),
    );
  });
});
