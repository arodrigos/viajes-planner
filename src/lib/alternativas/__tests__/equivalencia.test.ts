import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATEGORIAS_PARADA, type CategoriaParada } from "@/lib/plan/tipos";
import { DURACION_POR_CATEGORIA } from "../duraciones";
import { distanciaMetros, esEquivalente } from "../equivalencia";

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

  it("rechaza duración 30 min en un museo (rango 45–180 min)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 30, coordenadas: { lat: 40.4138, lon: -3.6921 } };
    const resultado = esEquivalente(paradaMadrid, alternativa, "familiar");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/duración/);
  });

  it("acepta duración 100 min vs parada de 90 min (dentro del rango)", () => {
    const alternativa = { categoria: "museo" as const, duracion_min: 100, coordenadas: { lat: 40.4148, lon: -3.6931 } };
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

// alc-ac3: rango por categoría, no ±30 % de la duración del modelo.
describe("esEquivalente con rangos por categoría (alc-ac3)", () => {
  const coordenadasParada = { lat: 40.4138, lon: -3.6921 };
  const coordenadasCerca = { lat: 40.4148, lon: -3.6931 };

  it("acepta un museo de 150 min para un museo que el modelo estimó en 90 min", () => {
    const parada = { categoria: "museo" as const, duracion_min: 90, coordenadas: coordenadasParada };
    const alternativa = { categoria: "museo" as const, duracion_min: 150, coordenadas: coordenadasCerca };
    expect(esEquivalente(parada, alternativa, "pareja").equivalente).toBe(true);
  });

  it("descarta un museo de 300 min y el motivo nombra el rango 45–180", () => {
    const parada = { categoria: "museo" as const, duracion_min: 90, coordenadas: coordenadasParada };
    const alternativa = { categoria: "museo" as const, duracion_min: 300, coordenadas: coordenadasCerca };
    const resultado = esEquivalente(parada, alternativa, "pareja");
    expect(resultado.equivalente).toBe(false);
    expect(resultado.motivo).toMatch(/45–180/);
  });

  it.each([
    ["mirador", 10, false],
    ["mirador", 15, true],
    ["mirador", 60, true],
    ["mirador", 61, false],
    ["parque", 30, true],
    ["parque", 151, false],
    ["comida", 44, false],
    ["comida", 120, true],
  ] as const)("%s de %i min -> %s", (categoria, duracion, esperado) => {
    const parada = { categoria, duracion_min: 60, coordenadas: coordenadasParada };
    const alternativa = { categoria, duracion_min: duracion, coordenadas: coordenadasCerca };
    expect(esEquivalente(parada, alternativa, "pareja").equivalente).toBe(esperado);
  });

  it("rechaza unas coordenadas que coinciden con las de la parada a 5 decimales", () => {
    const parada = { categoria: "museo" as const, duracion_min: 90, coordenadas: coordenadasParada };
    const alternativa = { categoria: "museo" as const, duracion_min: 90, coordenadas: { lat: 40.413801, lon: -3.692099 } };
    expect(esEquivalente(parada, alternativa, "pareja").equivalente).toBe(false);
  });

  const categoriaArb = fc.constantFrom<CategoriaParada>(...CATEGORIAS_PARADA);
  const coordenadasArb = fc.record({ lat: fc.double({ min: 40, max: 41, noNaN: true }), lon: fc.double({ min: -4, max: -3, noNaN: true }) });

  it("invariante 1: esEquivalente no depende de parada.duracion_min", () => {
    fc.assert(
      fc.property(
        categoriaArb,
        coordenadasArb,
        coordenadasArb,
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 1, max: 600 }),
        (categoria, cParada, cAlt, duracionA, duracionB, duracionAlt) => {
          const alternativa = { categoria, duracion_min: duracionAlt, coordenadas: cAlt };
          const a = esEquivalente({ categoria, duracion_min: duracionA, coordenadas: cParada }, alternativa, "pareja");
          const b = esEquivalente({ categoria, duracion_min: duracionB, coordenadas: cParada }, alternativa, "pareja");
          expect(a).toEqual(b);
        },
      ),
    );
  });

  it("invariantes 2 y 5: lo aceptado está en el rango, es de la misma categoría, dentro del radio y no coincide con la parada", () => {
    fc.assert(
      fc.property(
        categoriaArb,
        categoriaArb,
        coordenadasArb,
        coordenadasArb,
        fc.integer({ min: 1, max: 600 }),
        fc.constantFrom("familiar", "pareja"),
        (categoriaParada, categoriaAlt, cParada, cAlt, duracionAlt, perfil) => {
          const resultado = esEquivalente(
            { categoria: categoriaParada, duracion_min: 60, coordenadas: cParada },
            { categoria: categoriaAlt, duracion_min: duracionAlt, coordenadas: cAlt },
            perfil,
          );
          if (!resultado.equivalente) return;
          const rango = DURACION_POR_CATEGORIA[categoriaParada];
          expect(categoriaAlt).toBe(categoriaParada);
          expect(duracionAlt).toBeGreaterThanOrEqual(rango.min);
          expect(duracionAlt).toBeLessThanOrEqual(rango.max);
          expect(distanciaMetros(cParada, cAlt)).toBeLessThanOrEqual(perfil === "familiar" ? 2000 : 3000);
          expect([Math.round(cParada.lat * 1e5), Math.round(cParada.lon * 1e5)]).not.toEqual([Math.round(cAlt.lat * 1e5), Math.round(cAlt.lon * 1e5)]);
        },
      ),
    );
  });
});
