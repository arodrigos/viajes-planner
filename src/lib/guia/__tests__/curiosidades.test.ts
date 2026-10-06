import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { extraerCuriosidades, partirFrases } from "../curiosidades";
import { esUrlWikipedia, esUrlWikivoyage, curiosidadesSeguras, guiaSegura } from "../seguridad";
import { MAX_CONSEJO, MAX_TEXTO } from "../wikitexto";

const real = JSON.parse(readFileSync(join(process.cwd(), "fixtures/guia/es-wikipedia-real-alcazar.json"), "utf8")) as { extract: string };

describe("extraerCuriosidades (gui-ac2)", () => {
  it("con el extracto real de 4 frases quita la primera y deja 2 literales", () => {
    const c = extraerCuriosidades(real.extract);
    expect(c).toHaveLength(2);
    expect(c[0]).toBe("El palacio original se edificó en la Alta Edad Media.");
    for (const f of c) expect(real.extract).toContain(f);
  });
  it("un extracto de una sola frase no da curiosidades", () => {
    expect(extraerCuriosidades("La Giralda es el campanario de la catedral de Sevilla.")).toEqual([]);
  });
  it("vacío tampoco", () => {
    expect(extraerCuriosidades("")).toEqual([]);
  });
});

describe("invariante 3: cada curiosidad aparece literal en el extracto", () => {
  const frase = fc.stringMatching(/^[A-ZÁÉ][a-záéíóú ,]{20,120}[.!?]$/);
  it("sobre extractos generados", () => {
    fc.assert(
      fc.property(fc.array(frase, { maxLength: 8 }), (frases) => {
        const extracto = frases.join(" ");
        const compacto = extracto.replace(/\s+/g, " ");
        const c = extraerCuriosidades(extracto);
        expect(c.length).toBeLessThanOrEqual(2);
        for (const f of c) {
          expect(compacto).toContain(f);
          expect(f.length).toBeLessThanOrEqual(MAX_TEXTO);
        }
        expect(partirFrases(extracto).length).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
  it("sobre texto arbitrario", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 600 }), (extracto) => {
        const compacto = extracto.replace(/\s+/g, " ");
        for (const f of extraerCuriosidades(extracto)) expect(compacto).toContain(f);
      }),
      { numRuns: 300 },
    );
  });
});

describe("invariante 2: URLs y licencia (lectura segura)", () => {
  it("solo https en wikivoyage.org / wikipedia.org", () => {
    expect(esUrlWikivoyage("https://en.wikivoyage.org/wiki/Lisbon")).toBe(true);
    expect(esUrlWikivoyage("http://en.wikivoyage.org/wiki/Lisbon")).toBe(false);
    expect(esUrlWikivoyage("https://wikivoyage.org.evil.com/")).toBe(false);
    expect(esUrlWikivoyage("javascript:alert(1)")).toBe(false);
    expect(esUrlWikipedia("https://es.wikipedia.org/wiki/X")).toBe(true);
    expect(esUrlWikipedia("https://es.wikivoyage.org/wiki/X")).toBe(false);
  });
  it("guiaSegura y curiosidadesSeguras solo devuelven datos que cumplen el invariante", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 500 }),
        fc.webUrl(),
        fc.constantFrom("CC BY-SA", "CC0", ""),
        (consejo, url, licencia) => {
          const g = guiaSegura({ consejo, url, licencia: licencia as "CC BY-SA" });
          if (g) {
            expect(g.consejo).not.toMatch(/[{}[\]<>]/);
            expect(g.consejo.length).toBeLessThanOrEqual(MAX_CONSEJO);
            expect(esUrlWikivoyage(g.url)).toBe(true);
            expect(g.licencia).toBe("CC BY-SA");
          }
          const c = curiosidadesSeguras({ frases: [consejo], url });
          if (c) {
            expect(esUrlWikipedia(c.url)).toBe(true);
            for (const f of c.frases) expect(f).not.toMatch(/[{}[\]<>]/);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
