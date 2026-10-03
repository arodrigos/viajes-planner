import { describe, expect, it } from "vitest";
import { mejorSimilitud, normalizarNombre, similitudDice } from "../normalizar";

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
