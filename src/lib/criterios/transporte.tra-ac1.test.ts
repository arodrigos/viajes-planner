import fc from "fast-check";
import { describe, expect, it } from "vitest";
import fixturePais from "../../../fixtures/criterios-pais.json";
import { MODOS_TRANSPORTE } from "@/lib/criterios/tipos";
import { validarCriterios } from "@/lib/criterios/validar";
import { construirPrompt } from "@/lib/trabajador/prompt";
import type { CriteriosViaje } from "@/lib/criterios/tipos";

const BASE = {
  destino_o_tipo: "Portugal",
  fechas: { modo: "epoca", epoca: "verano" },
  dias: 8,
  personas: [{ edad: 40 }],
  perfil: "familiar",
  presupuesto_eur: 3000,
};

describe("transporte en los criterios (tra-ac1, tra-ac2)", () => {
  it("la fixture de país con tres medios valida", () => {
    expect(validarCriterios(fixturePais).valido).toBe(true);
  });

  it("un criterio antiguo, sin el campo, sigue validando", () => {
    expect(validarCriterios(BASE)).toEqual({ valido: true, errores: [] });
  });

  it("un medio desconocido da «Medio de transporte no válido», una sola vez", () => {
    const r = validarCriterios({ ...BASE, transporte: ["barco", "globo"] });
    expect(r.valido).toBe(false);
    expect(r.errores).toEqual(["Medio de transporte no válido"]);
  });

  it("repetidos y no-array también se rechazan con ese mensaje", () => {
    expect(validarCriterios({ ...BASE, transporte: ["tren", "tren"] }).errores).toEqual(["Medio de transporte no válido"]);
    expect(validarCriterios({ ...BASE, transporte: "tren" }).errores).toEqual(["Medio de transporte no válido"]);
  });

  it("llega al prompt dentro de los criterios del usuario", () => {
    const prompt = construirPrompt({ ...BASE, transporte: ["tren", "autobus"] } as CriteriosViaje);
    const dentro = prompt.slice(prompt.indexOf("<criterios-usuario>"));
    expect(dentro).toContain('"transporte":["tren","autobus"]');
  });

  // Invariantes 1 y 2 del bloque.
  it("property: sin campo siempre valida; con campo, solo si son modos conocidos y sin repetir", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom(...MODOS_TRANSPORTE), fc.string()), { maxLength: 8 }), (lista) => {
        const esperado =
          lista.every((m) => (MODOS_TRANSPORTE as readonly string[]).includes(m)) && new Set(lista).size === lista.length;
        expect(validarCriterios({ ...BASE, transporte: lista }).valido).toBe(esperado);
        expect(validarCriterios(BASE).valido).toBe(true);
      }),
    );
  });
});
