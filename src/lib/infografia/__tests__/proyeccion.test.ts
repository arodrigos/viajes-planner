import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { proyectarRuta } from "../proyeccion";

const RECUADRO = { ancho: 960, alto: 300, margen: 40 };
const punto = fc.record({ lat: fc.double({ min: -85, max: 85, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }) });

describe("proyectarRuta (inf-ac2, invariante 2)", () => {
  it("deja todos los puntos dentro del recuadro para cualquier conjunto, incluida una sola etapa", () => {
    fc.assert(
      fc.property(fc.array(punto, { minLength: 1, maxLength: 12 }), (puntos) => {
        const salida = proyectarRuta(puntos, RECUADRO);
        expect(salida).toHaveLength(puntos.length);
        for (const p of salida) {
          expect(p.x).toBeGreaterThanOrEqual(RECUADRO.margen);
          expect(p.x).toBeLessThanOrEqual(RECUADRO.ancho - RECUADRO.margen);
          expect(p.y).toBeGreaterThanOrEqual(RECUADRO.margen);
          expect(p.y).toBeLessThanOrEqual(RECUADRO.alto - RECUADRO.margen);
        }
      }),
    );
  });

  it("etapas casi coincidentes caen dentro y no se dispersan hasta los bordes", () => {
    fc.assert(
      fc.property(punto, fc.array(fc.double({ min: -1e-6, max: 1e-6, noNaN: true }), { minLength: 2, maxLength: 4 }), (base, ruido) => {
        const salida = proyectarRuta(ruido.map((d) => ({ lat: base.lat + d, lon: base.lon + d })), RECUADRO);
        const xs = salida.map((p) => p.x);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1);
      }),
    );
  });

  it("una sola etapa se centra y sin puntos no devuelve nada", () => {
    expect(proyectarRuta([{ lat: 38.7, lon: -9.1 }], RECUADRO)).toEqual([{ x: 480, y: 150 }]);
    expect(proyectarRuta([], RECUADRO)).toEqual([]);
  });

  it("Lisboa queda al sur-oeste de Oporto", () => {
    const [lisboa, oporto] = proyectarRuta([{ lat: 38.72, lon: -9.14 }, { lat: 41.15, lon: -8.61 }], RECUADRO);
    expect(lisboa.y).toBeGreaterThan(oporto.y);
    expect(lisboa.x).toBeLessThan(oporto.x);
  });
});
