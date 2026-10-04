import { describe, expect, it } from "vitest";
import { urlComoLlegar } from "../urlComoLlegar";

// dest-ac2: enlace determinista, sin clave y sin afiliación, con
// coordenadas fijas -- mismo patrón de test que urlRecorridoDia.test.ts.
describe("urlComoLlegar (dest-ac2)", () => {
  it("construye un enlace a pie entre dos puntos, sin waypoints", () => {
    const origen = { lat: 39.8578, lon: -4.0226 };
    const destino = { lat: 39.8496, lon: -4.0273 };
    expect(urlComoLlegar(origen, destino)).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=39.8578,-4.0226&destination=39.8496,-4.0273&travelmode=walking",
    );
  });

  it("nunca lleva clave ni parámetro de afiliación", () => {
    const href = urlComoLlegar({ lat: 1, lon: 2 }, { lat: 3, lon: 4 });
    expect(href).not.toContain("key=");
    expect(href).not.toContain("affiliate");
  });
});
