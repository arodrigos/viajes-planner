import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INTERESES, MAX_INTERESES, RITMOS } from "@/lib/criterios/intereses";
import { validarCriterios } from "@/lib/criterios/validar";

const BASE = {
  destino_o_tipo: "Valencia",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 3,
  personas: [{ edad: 40 }, { edad: 7 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};

describe("ritmo e intereses en los criterios (rit-ac3)", () => {
  it("unos criterios antiguos, sin los campos, siguen validando", () => {
    expect(validarCriterios(BASE)).toEqual({ valido: true, errores: [] });
  });

  it("ritmo e intereses válidos pasan, y intereses vacío equivale a no marcar", () => {
    expect(validarCriterios({ ...BASE, ritmo: "tranquilo", intereses: ["museos", "parques-ninos"] }).valido).toBe(true);
    expect(validarCriterios({ ...BASE, intereses: [] }).valido).toBe(true);
  });

  it("un interés fuera de la lista nombra el campo", () => {
    const r = validarCriterios({ ...BASE, intereses: ["museos", "playa"] });
    expect(r.valido).toBe(false);
    expect(r.errores.join(" ")).toMatch(/[Ii]ntereses/);
  });

  it("cuatro intereses, repetidos y texto libre se rechazan con el mensaje de intereses", () => {
    for (const intereses of [["museos", "naturaleza", "compras", "monumentos"], ["museos", "museos"], "museos", ["Quiero ir a un museo"]]) {
      const r = validarCriterios({ ...BASE, intereses });
      expect(r.valido, JSON.stringify(intereses)).toBe(false);
      expect(r.errores, JSON.stringify(intereses)).toEqual(["Intereses no válidos: elige hasta 3 de la lista, sin repetir"]);
    }
  });

  it("un ritmo desconocido nombra el campo", () => {
    const r = validarCriterios({ ...BASE, ritmo: "relajado" });
    expect(r.valido).toBe(false);
    expect(r.errores).toEqual(["Ritmo no válido"]);
  });

  // Invariante: cualquier entrada que valide trae intereses ⊆ INTERESES, sin
  // repetidos y con 3 como mucho.
  it("property: lo que valida cumple la lista cerrada, sin repetidos y hasta 3", () => {
    const candidato = fc.oneof(fc.constantFrom(...INTERESES), fc.string({ maxLength: 12 }));
    fc.assert(
      fc.property(fc.array(candidato, { maxLength: 6 }), (intereses) => {
        const r = validarCriterios({ ...BASE, intereses });
        if (!r.valido) return true;
        return (
          intereses.every((i) => (INTERESES as readonly string[]).includes(i)) &&
          new Set(intereses).size === intereses.length &&
          intereses.length <= MAX_INTERESES
        );
      }),
    );
  });

  it("property: solo valida un ritmo de la lista", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...RITMOS), fc.string({ maxLength: 10 })), (ritmo) => {
        return validarCriterios({ ...BASE, ritmo }).valido === (RITMOS as readonly string[]).includes(ritmo);
      }),
    );
  });
});
