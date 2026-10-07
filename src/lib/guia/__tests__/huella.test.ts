import { describe, expect, it } from "vitest";
import { FORMATO_CURIOSIDADES, pendiente } from "../curiosidadesPlan";
import { MAX_FRASE, MIN_FRASE } from "../candidatas";
import { calcularHuellaReglas, HUELLA_REGLAS_CURIOSIDADES } from "../huella";
import fc from "fast-check";

// rp-ac2: si cambian las listas o las regex que deciden qué curiosidades se
// guardan, lo ya guardado hay que rehacerlo, y eso solo ocurre subiendo el
// formato (#171 subió FORMATO_GUIA por error y las frases cortadas se quedaron).
describe("huella de las reglas de curiosidades (rp-ac2)", () => {
  it("la huella vigente coincide con la declarada: si cambian las reglas hay que subir FORMATO_CURIOSIDADES y actualizar huella.ts", () => {
    const calculada = calcularHuellaReglas();
    expect(
      calculada,
      `Las reglas de curiosidades han cambiado (huella ${calculada}). Sube FORMATO_CURIOSIDADES en curiosidadesPlan.ts para que el trabajador rehaga lo guardado, y copia aquí el mismo formato y esta huella en huella.ts.`,
    ).toBe(HUELLA_REGLAS_CURIOSIDADES.sha256);
  });

  it("el formato de la huella es el formato vigente: cambiar el formato sin actualizar la huella también falla", () => {
    expect(
      HUELLA_REGLAS_CURIOSIDADES.formato,
      "FORMATO_CURIOSIDADES y HUELLA_REGLAS_CURIOSIDADES.formato deben subir juntos, con la huella nueva.",
    ).toBe(FORMATO_CURIOSIDADES);
  });

  // cur-ac2: los umbrales de longitud deciden qué frases son candidatas, así
  // que alterarlos tiene que cambiar la huella y dejarlos igual no.
  it("cambiar MIN_FRASE o MAX_FRASE cambia la huella y dejarlos igual la mantiene", () => {
    const base = calcularHuellaReglas();
    expect(calcularHuellaReglas({ min: MIN_FRASE, max: MAX_FRASE })).toBe(base);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 600 }), fc.integer({ min: 1, max: 600 }), (min, max) => {
        const igual = min === MIN_FRASE && max === MAX_FRASE;
        return (calcularHuellaReglas({ min, max }) === base) === igual;
      }),
      { numRuns: 100 },
    );
  });

  it("FORMATO_CURIOSIDADES vale 6", () => {
    expect(FORMATO_CURIOSIDADES).toBe(6);
  });

  it("la huella es un sha-256 en hexadecimal", () => {
    expect(HUELLA_REGLAS_CURIOSIDADES.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("pendiente (rp-ac1)", () => {
  it("sin items o con formato anterior es pendiente sea cual sea su selección o mejora_intentada", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FORMATO_CURIOSIDADES - 1 }),
        fc.constantFrom("modelo", "heuristica"),
        fc.boolean(),
        (formato, seleccion, mejora) => {
          const base = { frases: [] as string[], url: "", seleccion, mejora_intentada: mejora };
          return pendiente({ ...base, formato, items: [] }) && pendiente({ ...base, formato, items: [{ texto: "x", idioma: "es", fuente: "wikipedia", url: "u", seleccion }] });
        },
      ),
      { numRuns: 30 },
    );
  });

  it("sin formato guardado y sin curiosidades es pendiente; con el formato vigente y modelo, no", () => {
    expect(pendiente(null)).toBe(true);
    expect(pendiente({ frases: [], url: "", items: [{ texto: "x", idioma: "es", fuente: "wikipedia", url: "u", seleccion: "modelo" }], seleccion: "modelo", mejora_intentada: true })).toBe(true);
    expect(pendiente({ formato: FORMATO_CURIOSIDADES, frases: [], url: "", items: [{ texto: "x", idioma: "es", fuente: "wikipedia", url: "u", seleccion: "modelo" }], seleccion: "modelo", mejora_intentada: true })).toBe(false);
  });
});
