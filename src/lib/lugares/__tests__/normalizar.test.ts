import { describe, expect, it } from "vitest";
import { limpiarNombreBusqueda, mejorSimilitud, normalizarNombre, similitudDice } from "../normalizar";

describe("normalizarNombre", () => {
  it("quita diacríticos, mayúsculas y artículos", () => {
    expect(normalizarNombre("El Museo del Prado")).toBe("museo prado");
    expect(normalizarNombre("Catedral de Sevilla")).toBe("catedral sevilla");
  });
});

describe("similitudDice", () => {
  it("es 1 para cadenas idénticas y 0 para cadenas sin relación", () => {
    expect(similitudDice("museo prado", "museo prado")).toBe(1);
    expect(similitudDice("museo prado", "estacion zzzz")).toBeLessThan(0.3);
  });

  it("acepta variantes del mismo sitio (lug-ac2)", () => {
    const similitud = similitudDice(normalizarNombre("Museo del Prado"), normalizarNombre("Museo Nacional del Prado"));
    expect(similitud).toBeGreaterThanOrEqual(0.6);
  });
});

describe("mejorSimilitud", () => {
  it("se queda con la mejor similitud entre varios nombres alternativos", () => {
    const similitud = mejorSimilitud("Museo del Prado", ["Prado Museum", "Museo Nacional del Prado"]);
    expect(similitud).toBeGreaterThanOrEqual(0.6);
  });
});

// alt-ac1 (feedback del gatekeeper, iteración 24): casos reales medidos
// con el comando de manifiesto.verificacion_modelo_real que no resolvían
// por venir con una coletilla de actividad delante del sitio real.
describe("limpiarNombreBusqueda (alt-ac1)", () => {
  it("quita la coletilla de actividad y deja el sitio real buscable", () => {
    expect(limpiarNombreBusqueda("Cena en Ruzafa")).toBe("Ruzafa");
    expect(limpiarNombreBusqueda("Comida cerca del Parque Gulliver")).toBe("Parque Gulliver");
    expect(limpiarNombreBusqueda("Compras en la calle Colón")).toBe("calle Colón");
    expect(limpiarNombreBusqueda("Paseo nocturno por el Puente de l'Assut de l'Or")).toBe("Puente de l'Assut de l'Or");
  });

  it("quita el cualificador final (paréntesis o adjetivo de momento del día) sin tocar el nombre real", () => {
    expect(limpiarNombreBusqueda("Jardín del Turia (tramo junto a Gulliver)")).toBe("Jardín del Turia");
    expect(limpiarNombreBusqueda("Plaza del Ayuntamiento iluminada")).toBe("Plaza del Ayuntamiento");
  });

  it("deja intacto un nombre real que no lleva ninguna coletilla", () => {
    expect(limpiarNombreBusqueda("Museo del Prado")).toBe("Museo del Prado");
    expect(limpiarNombreBusqueda("Templo de Debod")).toBe("Templo de Debod");
  });

  it("nunca deja la cadena vacía: si tras limpiar no queda nada, devuelve el nombre original", () => {
    expect(limpiarNombreBusqueda("Paseo por")).toBe("Paseo por");
  });
});
