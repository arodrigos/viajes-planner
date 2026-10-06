import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CosteParada, Dia, Parada } from "@/lib/plan/tipos";
import { ensamblarCoste, ensamblarMotivo } from "../ensamblar";
import { calcularPresupuesto } from "../calcular";
import { textoCabeceraPresupuesto, textoPrecioParada } from "../texto";

const costeArb: fc.Arbitrary<CosteParada> = fc.record({
  importe_eur: fc.integer({ min: 0, max: 200_000 }).map((c) => c / 100),
  por: fc.constantFrom("persona" as const, "grupo" as const, "gratis" as const),
  procedencia: fc.constantFrom("estimado" as const, "wikivoyage" as const),
  fecha: fc.constant("2026-10-05"),
});

const paradaArb: fc.Arbitrary<Parada> = fc.option(costeArb, { nil: undefined }).map((coste, ) => ({
  id: "p",
  franja_id: "manana",
  nombre: "x",
  descripcion: "x",
  duracion_min: 60,
  prioridad: 50,
  procedencia: { fuente: "propuesto-sin-verificar" as const },
  ...(coste ? { coste } : {}),
}));

const diaArb: fc.Arbitrary<Dia> = fc.array(paradaArb, { maxLength: 6 }).map((paradas) => ({ fecha: "2026-11-07", franjas: [], paradas }));
const planArb = fc.record({ personas: fc.integer({ min: 1, max: 12 }), dias: fc.array(diaArb, { maxLength: 8 }) });

function importeParada(parada: Parada, personas: number): number {
  const coste = parada.coste;
  if (!coste) return 0;
  return Math.round(coste.importe_eur * 100) * (coste.por === "persona" ? personas : 1);
}

describe("calcularPresupuesto (mot-ac2, invariantes)", () => {
  it("total == suma de totales por día, y cada día == suma de importe × personas (o importe si es por grupo)", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const resultado = calcularPresupuesto(plan);
        const sumaDias = resultado.por_dia.reduce((acumulado, dia) => acumulado + Math.round(dia.total_eur * 100), 0);
        expect(Math.round(resultado.total_eur * 100)).toBe(sumaDias);
        plan.dias.forEach((dia, indice) => {
          const esperado = dia.paradas.reduce((acumulado, parada) => acumulado + importeParada(parada, plan.personas), 0);
          expect(Math.round(resultado.por_dia[indice].total_eur * 100)).toBe(esperado);
        });
      }),
    );
  });

  it("total_estimado + total_de_fuente == total", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const r = calcularPresupuesto(plan);
        expect(Math.round(r.total_estimado_eur * 100) + Math.round(r.total_de_fuente_eur * 100)).toBe(Math.round(r.total_eur * 100));
      }),
    );
  });

  it("ningún importe guardado por el ensamblador es negativo, NaN ni mayor de 2.000 €/persona", () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ noNaN: false }), fc.integer(), fc.string(), fc.constant(undefined), fc.constant(null)), (cruda) => {
        const coste = ensamblarCoste(cruda, new Date("2026-10-05T10:00:00Z"));
        if (coste === undefined) return;
        expect(Number.isFinite(coste.importe_eur)).toBe(true);
        expect(coste.importe_eur).toBeGreaterThanOrEqual(0);
        expect(coste.importe_eur).toBeLessThanOrEqual(2000);
      }),
    );
  });

  it("un motivo solo se acepta entre 1 y 300 caracteres", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 500 }), fc.integer(), fc.constant(undefined)), (cruda) => {
        const motivo = ensamblarMotivo(cruda);
        if (motivo !== undefined) {
          expect(motivo.length).toBeGreaterThanOrEqual(1);
          expect(motivo.length).toBeLessThanOrEqual(300);
        }
      }),
    );
  });
});

describe("textos del presupuesto (mot-ac1)", () => {
  const coste = (por: CosteParada["por"], importe: number): CosteParada => ({ importe_eur: importe, por, procedencia: "estimado", fecha: "2026-10-05" });

  it("precio por parada: persona, gratis y ausente", () => {
    expect(textoPrecioParada(coste("persona", 15))).toBe("Precio orientativo: 15 €/persona · estimado");
    expect(textoPrecioParada(coste("gratis", 0))).toBe("Gratis");
    expect(textoPrecioParada(undefined)).toBe("Sin precio orientativo");
  });

  it("cabecera: estimado frente al presupuesto, aviso al superarlo y estado vacío", () => {
    const base = { total_estimado_eur: 60, total_de_fuente_eur: 0 };
    expect(textoCabeceraPresupuesto({ ...base, total_eur: 60, tu_presupuesto_eur: 900 })).toEqual({
      resumen: "Visitas: ~60 € estimados · Tu presupuesto: 900 €",
    });
    expect(textoCabeceraPresupuesto({ total_eur: 1200, total_estimado_eur: 1200, total_de_fuente_eur: 0, tu_presupuesto_eur: 900 }).aviso).toBe(
      "Las visitas estimadas superan tu presupuesto en ~300 €",
    );
    expect(textoCabeceraPresupuesto({ total_eur: 0, total_estimado_eur: 0, total_de_fuente_eur: 0, tu_presupuesto_eur: 900 }).resumen).toBe(
      "Sin estimación de gasto en visitas",
    );
  });
});
