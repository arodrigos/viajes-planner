import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ItemCuriosidad } from "@/lib/plan/tipos";
import { ABREVIATURAS_INTERNAS, sanearCuriosidad, sanearFrases, sanearItems, terminaEnAbreviatura } from "../sanear";

const INVISIBLE = /[​‌‍⁠­﻿]/;

const item = (texto: string, fuente: "wikipedia" | "wikidata" = "wikipedia"): ItemCuriosidad => ({
  texto, fuente, idioma: fuente === "wikidata" ? "es" : "en", seleccion: "modelo",
  url: fuente === "wikidata" ? "https://www.wikidata.org/wiki/Q1" : "https://en.wikipedia.org/wiki/X",
});

describe("sanearCuriosidad (cur-ac1)", () => {
  it("quita los invisibles y normaliza espacios", () => {
    expect(sanearCuriosidad("Abrió​ en  1857. Fue﻿   grande.")).toBe("Abrió en 1857. Fue grande.");
  });

  it("es idempotente y no deja invisibles para ninguna cadena (property)", () => {
    const invisibles = fc.constantFrom("​", "‌", "‍", "⁠", "­", "﻿", " ", "\n", "a", "b", ".");
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.array(invisibles).map((a) => a.join(""))), (x) => {
        const una = sanearCuriosidad(x);
        expect(sanearCuriosidad(una)).toBe(una);
        expect(INVISIBLE.test(una)).toBe(false);
      }),
    );
  });
});

describe("frases cortadas por abreviatura", () => {
  it("detecta cada abreviatura de la lista al final y solo ahí", () => {
    for (const a of ABREVIATURAS_INTERNAS) {
      expect(terminaEnAbreviatura(`Es de Warner ${a}.`)).toBe(true);
      expect(terminaEnAbreviatura(`${a}.`)).toBe(true);
    }
    expect(terminaEnAbreviatura("Se construyó en el 300 a. C.")).toBe(false);
    expect(terminaEnAbreviatura("Abrió su Costa.")).toBe(false);
    expect(terminaEnAbreviatura("Visitó St. Paul's Cathedral.")).toBe(false);
  });

  it("sanearItems descarta la acabada en «Bros.» y las vacías", () => {
    const salida = sanearItems([item("The Studio Tour is run by Warner Bros."), item("​"), item("It opened in 2012.")]);
    expect(salida.map((i) => i.texto)).toEqual(["It opened in 2012."]);
    expect(sanearFrases(["Fue de Warner Bros.", "Otra frase normal."])).toEqual(["Otra frase normal."]);
  });
});

describe("fundación frente a apertura (cur-ac2, invariante 9)", () => {
  it("con apertura descarta la fundación de Wikidata, pero no la de Wikipedia", () => {
    const salida = sanearItems([item("Se fundó en 1909.", "wikidata"), item("Se inauguró en 1857.", "wikidata"), item("Se fundó en 1909 por ley.")]);
    expect(salida.map((i) => i.texto)).toEqual(["Se inauguró en 1857.", "Se fundó en 1909 por ley."]);
  });

  it("sin apertura conserva la fundación (también «La institución se fundó»)", () => {
    expect(sanearItems([item("La institución se fundó en 1889.", "wikidata")])).toHaveLength(1);
  });

  it("nunca quedan fundación y apertura de Wikidata a la vez (property)", () => {
    const textos = fc.constantFrom("Se fundó en 1900.", "La institución se fundó en 1850.", "Se inauguró en 1857.", "Se abrió en 1990.", "Lo diseñó Foster.");
    fc.assert(
      fc.property(fc.array(textos, { maxLength: 8 }), (lista) => {
        const t = sanearItems(lista.map((x) => item(x, "wikidata"))).map((i) => i.texto);
        const fundacion = t.some((x) => /fundó/.test(x));
        const apertura = t.some((x) => /inauguró|abrió/.test(x));
        expect(fundacion && apertura).toBe(false);
      }),
    );
  });
});
