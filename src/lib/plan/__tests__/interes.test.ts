import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATEGORIAS_PARADA } from "@/lib/plan/tipos";
import { INTERESES, interesDeParada, type Interes } from "@/lib/criterios/intereses";
import { aPlanPublico } from "@/lib/plan/publico";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import type { Plan } from "@/lib/plan/tipos";

function planConCategorias(): Plan {
  const base = planFixture;
  const dia = base.dias[0];
  return {
    ...base,
    dias: [
      {
        ...dia,
        paradas: [
          { ...dia.paradas[0], categoria: "parque" },
          { ...dia.paradas[1], categoria: "comida" },
        ],
      },
    ],
  };
}

describe("interesDeParada (rit-ac5)", () => {
  it("manda el orden del usuario: un parque cita parques-ninos antes que naturaleza", () => {
    expect(interesDeParada("parque", ["parques-ninos", "naturaleza"])).toBe("parques-ninos");
    expect(interesDeParada("parque", ["naturaleza", "parques-ninos"])).toBe("naturaleza");
  });

  it("sin intereses, o sin encaje, no hay interés", () => {
    expect(interesDeParada("parque", null)).toBeUndefined();
    expect(interesDeParada("parque", [])).toBeUndefined();
    expect(interesDeParada("comida", ["museos"])).toBeUndefined();
    expect(interesDeParada(undefined, ["museos"])).toBeUndefined();
  });

  it("property: devuelve undefined o un elemento de la lista, nunca otro", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORIAS_PARADA),
        fc.uniqueArray(fc.constantFrom(...INTERESES), { maxLength: 3 }),
        (categoria, intereses) => {
          const r = interesDeParada(categoria, intereses as Interes[]);
          return r === undefined || intereses.includes(r);
        },
      ),
    );
  });
});

describe("aPlanPublico con intereses (rit-ac5)", () => {
  it("anota el interés de las paradas que encajan y solo de esas", () => {
    const publico = aPlanPublico(planConCategorias(), "familiar", 900, null, ["parques-ninos", "naturaleza"]);
    expect(publico.dias[0].paradas.map((p) => p.interes)).toEqual(["parques-ninos", undefined]);
  });

  it("sin intereses ninguna parada trae la clave interes", () => {
    const publico = aPlanPublico(planConCategorias(), "familiar", 900, null, null);
    for (const p of publico.dias[0].paradas) expect("interes" in p).toBe(false);
  });
});
