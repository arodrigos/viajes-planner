import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { interpretarUbicacion } from "../ubicacion";

afterEach(() => vi.unstubAllGlobals());

describe("interpretarUbicacion", () => {
  it.each([
    ["41.9028, 12.4964", { lat: 41.9028, lon: 12.4964 }],
    ["41,9028; 12,4964", { lat: 41.9028, lon: 12.4964 }],
    ["https://www.google.com/maps/place/Hotel/@41.9028,12.4964,17z/data=!3m1", { lat: 41.9028, lon: 12.4964 }],
    ["https://www.google.com/maps/place/X/data=!3d41.9!4d12.5", { lat: 41.9, lon: 12.5 }],
    ["https://www.openstreetmap.org/#map=18/41.9028/12.4964", { lat: 41.9028, lon: 12.4964 }],
    ["https://maps.apple.com/?ll=41.9028,12.4964&q=Hotel", { lat: 41.9028, lon: 12.4964 }],
    ["geo:-33.86,151.21", { lat: -33.86, lon: 151.21 }],
  ])("lee %s", (texto, esperado) => {
    expect(interpretarUbicacion(texto)).toEqual(esperado);
  });

  it("rechaza lo que no son coordenadas o están fuera de rango", () => {
    for (const malo of ["", "Hotel Sole Roma", "95, 12", "41, 200", "https://example.com/hotel"]) expect(interpretarUbicacion(malo)).toBeNull();
  });

  // Invariante: coordenadas válidas o null, y ninguna petición de red.
  it("property: devuelve coordenadas en rango o null y no hace ninguna petición", () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.tuple(fc.double({ noNaN: true }), fc.double({ noNaN: true })).map(([a, b]) => `${a}, ${b}`), fc.webUrl()), (texto) => {
        const c = interpretarUbicacion(texto);
        if (c) {
          expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
        }
      }),
      { numRuns: 500 },
    );
    expect(fetchEspia).not.toHaveBeenCalled();
  });
});
