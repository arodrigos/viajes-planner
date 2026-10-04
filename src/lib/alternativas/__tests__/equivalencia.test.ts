import { describe, expect, it } from "vitest";
import { esEquivalente } from "../equivalencia";

// alt-ac3: tabla de casos >= 8, igual que exige el criterio.
describe("esEquivalente (alt-ac3)", () => {
  const paradaMadrid = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } };

  it("acepta misma categoría a 1.900 m (perfil familiar)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.71454 } };
    expect(esEquivalente(paradaMadrid, alternativa, "familiar").equivalente).toBe(true);
  });

  it("rechaza a 2.100 m (perfil familiar)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.71691 } };
    const resultado = esEquivalente(paradaMadrid, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/m de la parada/);
  });

  it("acepta a 2.100 m con perfil pareja (umbral 3.000 m)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.71691 } };
    expect(esEquivalente(paradaMadrid, alternativa, "pareja").equivalente).toBe(true);
  });

  it("rechaza duración 45 min vs parada de 90 min (fuera de ±30 %)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 45, coordenadas: { lat: 40.4138, lon: -3.6921 } };
    const resultado = esEquivalente(paradaMadrid, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/duración/);
  });

  it("acepta duración 100 min vs parada de 90 min (dentro de ±30 %)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 100, coordenadas: { lat: 40.4138, lon: -3.6921 } };
    expect(esEquivalente(paradaMadrid, alternativa, "familiar").equivalente).toBe(true);
  });

  it("rechaza categoría distinta aunque esté cerca y dure lo mismo", () => {
    const alternativa = { categoria: "parque" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } };
    const resultado = esEquivalente(paradaMadrid, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/categoría/);
  });

  it("rechaza una alternativa sin coordenadas (no resolvió)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 90 };
    const resultado = esEquivalente(paradaMadrid, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/no resolvió/);
  });

  it("rechaza si la parada no tiene coordenadas con las que comparar", () => {
    const paradaSinResolver = { categoria: "museo" as const, duracion_min: 90, coordenadas: undefined };
    const alternativa = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.4138, lon: -3.6921 } };
    const resultado = esEquivalente(paradaSinResolver, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
  });

  it("hereda la franja de la parada por construcción -- no es responsabilidad de este filtro, se comprueba en resolverAlternativas", () => {
    // Documentado aquí para que quede constancia de por qué no hay un
    // caso de "franja distinta" en esta tabla: esEquivalente no recibe
    // franja_id porque una alternativa SIEMPRE hereda la de la parada que
    // sustituye (resolverAlternativas.ts), nunca se compara.
    expect(true).toBe(true);
  });
});
