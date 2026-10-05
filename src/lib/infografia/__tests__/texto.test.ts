import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { limpiarTexto, recortar } from "../texto";

const grafemas = (t: string) => Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(t), (s) => s.segment);
// Cadenas que mezclan lo que ensucia de verdad: espacios raros, controles,
// bidi, emoji compuestos y diacríticos combinantes.
const sucia = fc.array(fc.constantFrom("a", "Z", "ñ", " ", "  ", " ", "\t", "\n", "\u0007", "\u0085", "‮", "⁦", "👨‍👩‍👧‍👦", "é", "…", "-"), { maxLength: 40 }).map((p) => p.join(""));

describe("limpiarTexto (lam-ac1, invariante 1)", () => {
  it("nunca deja dobles espacios, bordes con espacio, controles ni bidi", () => {
    fc.assert(
      fc.property(fc.oneof(sucia, fc.string({ unit: "binary" })), (x) => {
        const l = limpiarTexto(x);
        expect(l).not.toMatch(/ {2}/);
        expect(l).toBe(l.trim());
        expect(l).not.toMatch(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/);
      }),
      { numRuns: 500 },
    );
  });

  it("une palabras con un espacio y quita NBSP, controles y bidi (cp-lam-01)", () => {
    expect(limpiarTexto("Torre  de Belém")).toBe("Torre de Belém");
    expect(limpiarTexto("Torre  de Belém")).toBe("Torre de Belém");
    expect(limpiarTexto("a‮b\u0007c")).toBe("abc");
    expect(limpiarTexto("a \u0007 b")).toBe("a b");
  });
});

describe("recortar (lam-ac1, invariantes 2 a 4)", () => {
  it("no pasa de max grafemas, «…» incluido", () => {
    fc.assert(
      fc.property(sucia, fc.integer({ min: 2, max: 30 }), (x, max) => {
        expect(grafemas(recortar(x, max)).length).toBeLessThanOrEqual(max);
      }),
      { numRuns: 500 },
    );
  });

  it("si cabe es idéntico a limpiarTexto; si no, acaba en «…» sobre un prefijo sin espacio final", () => {
    fc.assert(
      fc.property(sucia, fc.integer({ min: 2, max: 30 }), (x, max) => {
        const limpio = limpiarTexto(x);
        const r = recortar(x, max);
        if (grafemas(limpio).length <= max) {
          expect(r).toBe(limpio);
          expect(r.endsWith("…") && !limpio.endsWith("…")).toBe(false);
        } else {
          expect(r.endsWith("…")).toBe(true);
          const antes = r.slice(0, -1);
          expect(limpio.startsWith(antes)).toBe(true);
          expect(antes.endsWith(" ")).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("nunca parte un grafema: el resultado se compone de grafemas enteros del original", () => {
    fc.assert(
      fc.property(sucia, fc.integer({ min: 2, max: 30 }), (x, max) => {
        const original = grafemas(limpiarTexto(x));
        const cortado = grafemas(recortar(x, max).replace(/…$/, ""));
        // Cada grafema del resultado existe tal cual en el original, en el mismo orden de prefijo.
        cortado.forEach((g, i) => {
          if (i < cortado.length - 1 || !recortar(x, max).endsWith("…")) expect(original[i]).toBe(g);
        });
      }),
      { numRuns: 500 },
    );
  });

  it("un nombre de exactamente max grafemas sale entero (cp-lam-01, límite)", () => {
    expect(recortar("Torre de Belém", 14)).toBe("Torre de Belém");
    expect(recortar("Torre de Belém", 13)).toBe("Torre de Bel…");
  });

  it("el emoji compuesto queda entero o desaparece entero (cp-lam-01, límite)", () => {
    const t = "Visita familiar 👨‍👩‍👧‍👦 al acuario";
    for (const max of [16, 17, 18, 19]) {
      const r = recortar(t, max);
      expect(r.includes("👨") ? r.includes("👨‍👩‍👧‍👦") : true).toBe(true);
    }
    expect(recortar(t, 17)).toBe("Visita familiar…");
    expect(recortar(t, 18)).toBe("Visita familiar 👨‍👩‍👧‍👦…");
  });
});
