import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { frasesDeTexto, MAX_FRASE, MIN_FRASE, puntuarFrase } from "../candidatas";

// La primera frase del artículo es la definición y se descarta: cada texto de
// prueba lleva una definición delante.
const conDefinicion = (...resto: string[]) => ["Test Place is a venue in London.", ...resto].join("\n\n");

// cur-ac1: bajar MIN_FRASE a 15 deja pasar las frases cortas con año sin
// readmitir los restos de corte.
describe("frasesDeTexto con MIN_FRASE (cur-ac1)", () => {
  it("«It opened in 1910.» es candidata y recibe los puntos de año", () => {
    const frases = frasesDeTexto(conDefinicion("It opened in 1910."), "en");
    expect(frases).toContain("It opened in 1910.");
    // 2 por llevar dígitos y 2 por ser un año; 18 caracteres: sin bonus de longitud.
    expect(puntuarFrase("It opened in 1910.")).toBe(4);
  });

  it("los restos típicos de corte y las frases en minúscula siguen descartados", () => {
    const texto = conDefinicion("See also.", "e.g. the", "pp. 12–14.", "Ibid.", "it opened in 1910.");
    const frases = frasesDeTexto(texto, "en");
    for (const resto of ["See also.", "e.g. the", "pp. 12–14.", "Ibid.", "it opened in 1910."]) {
      expect(frases).not.toContain(resto);
    }
  });

  it("MIN_FRASE vale 15", () => {
    expect(MIN_FRASE).toBe(15);
  });
});

describe("frasesDeTexto (invariante de longitud)", () => {
  it("para cualquier texto, toda candidata mide entre MIN_FRASE y MAX_FRASE", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1500 }), fc.constantFrom("es", "en"), (texto, locale) => {
        return frasesDeTexto(texto, locale).every((f) => f.length >= MIN_FRASE && f.length <= MAX_FRASE);
      }),
      { numRuns: 200 },
    );
  });
});
