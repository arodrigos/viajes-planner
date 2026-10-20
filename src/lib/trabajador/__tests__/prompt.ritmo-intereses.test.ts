import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INTERESES, RITMOS } from "@/lib/criterios/intereses";
import type { CriteriosViaje, Perfil } from "@/lib/criterios/tipos";
import { construirPrompt } from "@/lib/trabajador/prompt";

const BASE: CriteriosViaje = {
  destino_o_tipo: "Valencia",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 3,
  personas: [{ edad: 40 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};

describe("prompt con ritmo e intereses", () => {
  it("property: sin ritmo ni intereses el prompt es el de siempre (normal e intereses vacíos no cambian la instrucción)", () => {
    fc.assert(
      fc.property(fc.constantFrom<Perfil>("familiar", "pareja", "amigos", "solo"), (perfil) => {
        const sin = construirPrompt({ ...BASE, perfil });
        const conVacios = construirPrompt({ ...BASE, perfil, ritmo: "normal", intereses: [] });
        const instruccion = (p: string) => p.slice(0, p.indexOf("<criterios-usuario>"));
        return instruccion(sin) === instruccion(conVacios) && !instruccion(sin).includes("intereses");
      }),
    );
  });

  it("con intereses añade la instrucción en el orden del usuario; el tope refleja el ritmo", () => {
    const prompt = construirPrompt({ ...BASE, ritmo: "tranquilo", intereses: ["parques-ninos", "museos"] });
    expect(prompt).toContain("Como máximo 1 parada(s)");
    expect(prompt.indexOf("Parques y juegos para niños")).toBeLessThan(prompt.indexOf("Museos"));
    expect(prompt).toContain("categorías: museo");
  });

  it("property: todos los ritmos y combinaciones de intereses producen un prompt con su instrucción solo si hay intereses", () => {
    fc.assert(
      fc.property(fc.constantFrom(...RITMOS), fc.uniqueArray(fc.constantFrom(...INTERESES), { maxLength: 3 }), (ritmo, intereses) => {
        const prompt = construirPrompt({ ...BASE, ritmo, intereses });
        return prompt.includes("ha marcado estos intereses") === intereses.length > 0;
      }),
    );
  });
});
