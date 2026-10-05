import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MODOS_TRANSPORTE, type Modo } from "@/lib/criterios/tipos";
import { TOPE_AVION_MIN, TOPE_TIERRA_MIN } from "../constantes";
import { estimarTraslado, topeDelModo } from "../traslados";

const LISBOA = { lat: 38.72, lon: -9.14 };
const OPORTO = { lat: 41.15, lon: -8.61 };

describe("estimarTraslado (dmc-ac2)", () => {
  it("Lisboa → Oporto con tren y autobús da autobús, ~329 km, ≤ 240 min y «estimado»", () => {
    const t = estimarTraslado(LISBOA, OPORTO, ["tren", "autobus"], 4);
    expect(t?.modo).toBe("autobus");
    expect(t?.distancia_km).toBeGreaterThan(320);
    expect(t?.distancia_km).toBeLessThan(335);
    expect(t?.duracion_min).toBeLessThanOrEqual(TOPE_TIERRA_MIN);
    expect(t?.procedencia).toBe("estimado");
  });

  it("con solo avión no hay tramo por debajo de 400 km", () => {
    expect(estimarTraslado(LISBOA, OPORTO, ["avion"], 4)).toBeNull();
  });

  it("el coche cuesta por vehículo de 5 plazas, no por persona", () => {
    const una = estimarTraslado(LISBOA, OPORTO, ["coche"], 1);
    const cinco = estimarTraslado(LISBOA, OPORTO, ["coche"], 5);
    const seis = estimarTraslado(LISBOA, OPORTO, ["coche"], 6);
    expect(cinco?.coste_eur).toBe(una?.coste_eur);
    expect(seis?.coste_eur).toBeCloseTo((una?.coste_eur ?? 0) * 2, 2);
  });

  // Invariante 5: un medio de los permitidos (o cualquiera si la lista está
  // vacía), duración ≤ tope del medio, procedencia «estimado», o ningún tramo.
  it("invariante: medio permitido, duración ≤ tope y procedencia «estimado», o ningún tramo", () => {
    const punto = fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lon: fc.double({ min: -179, max: 179, noNaN: true }) });
    const modos = fc.subarray([...MODOS_TRANSPORTE] as Modo[]);
    fc.assert(
      fc.property(punto, punto, modos, fc.integer({ min: 1, max: 12 }), (a, b, permitidos, personas) => {
        const t = estimarTraslado(a, b, permitidos, personas);
        if (!t) return;
        const lista: readonly Modo[] = permitidos.length > 0 ? permitidos : MODOS_TRANSPORTE;
        expect(lista).toContain(t.modo);
        expect(t.duracion_min).toBeLessThanOrEqual(t.modo === "avion" ? TOPE_AVION_MIN : TOPE_TIERRA_MIN);
        expect(t.duracion_min).toBeLessThanOrEqual(topeDelModo(t.modo));
        expect(t.procedencia).toBe("estimado");
        expect(t.coste_eur).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
});
