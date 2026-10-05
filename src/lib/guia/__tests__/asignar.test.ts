import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizarNombre, similitudDice } from "@/lib/lugares/normalizar";
import distance from "@turf/distance";
import { asignarFichas, RADIO_MAX_M, UMBRAL_SIMILITUD } from "../asignar";
import type { FichaGuia } from "../wikitexto";

const ficha = (nombre: string, extra: Partial<FichaGuia> = {}): FichaGuia => ({ tipo: "see", nombre, contenido: `Consejo de ${nombre}`, ...extra });

describe("asignarFichas (gui-ac1)", () => {
  it("asigna por nombre parecido", () => {
    const r = asignarFichas([ficha("Real Alcázar")], [{ id: "p1", nombre: "Real Alcázar de Sevilla" }]);
    expect(r.get("p1")?.nombre).toBe("Real Alcázar");
  });
  it("sin parecido ni cercanía no asigna: «La guía no tiene ficha de este sitio»", () => {
    expect(asignarFichas([ficha("Torre del Oro")], [{ id: "p1", nombre: "Mercado de Triana" }]).size).toBe(0);
  });
  it("asigna por distancia ≤ 150 m aunque el nombre no se parezca", () => {
    const r = asignarFichas([ficha("Xyz", { lat: 37.0, lon: -5.0 })], [{ id: "p1", nombre: "Abc", coordenadas: { lat: 37.001, lon: -5.0 } }]);
    expect(r.has("p1")).toBe(true);
  });
  it("a 300 m y sin nombre parecido no asigna", () => {
    const r = asignarFichas([ficha("Xyz", { lat: 37.0, lon: -5.0 })], [{ id: "p1", nombre: "Abc", coordenadas: { lat: 37.003, lon: -5.0 } }]);
    expect(r.size).toBe(0);
  });
});

describe("invariante 4: una ficha a lo sumo a una parada, y solo con umbral", () => {
  const nombre = fc.constantFrom("Catedral", "Real Alcázar", "Torre del Oro", "Giralda", "Plaza de España", "Parque María Luisa", "Real Alcázar de Sevilla");
  const coord = fc.record({ lat: fc.double({ min: 37, max: 37.01, noNaN: true }), lon: fc.double({ min: -6, max: -5.99, noNaN: true }) });
  const fichaArb = fc.record({ nombre, c: fc.option(coord, { nil: undefined }) });
  const paradaArb = fc.record({ nombre, c: fc.option(coord, { nil: undefined }) });

  it("cada ficha aparece como mucho una vez y cada asignación supera similitud o radio", () => {
    fc.assert(
      fc.property(fc.array(fichaArb, { maxLength: 8 }), fc.array(paradaArb, { maxLength: 8 }), (fs, ps) => {
        const fichas = fs.map((f) => ficha(f.nombre, f.c ? { lat: f.c.lat, lon: f.c.lon } : {}));
        const paradas = ps.map((p, i) => ({ id: `p${i}`, nombre: p.nombre, ...(p.c ? { coordenadas: p.c } : {}) }));
        const r = asignarFichas(fichas, paradas);
        const usadas = [...r.values()];
        expect(new Set(usadas).size).toBe(usadas.length);
        for (const [id, f] of r) {
          const p = paradas.find((x) => x.id === id)!;
          const sim = similitudDice(normalizarNombre(f.nombre), normalizarNombre(p.nombre));
          const m =
            f.lat !== undefined && f.lon !== undefined && p.coordenadas
              ? distance([f.lon, f.lat], [p.coordenadas.lon, p.coordenadas.lat], { units: "kilometers" }) * 1000
              : Infinity;
          expect(sim >= UMBRAL_SIMILITUD || m <= RADIO_MAX_M).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
