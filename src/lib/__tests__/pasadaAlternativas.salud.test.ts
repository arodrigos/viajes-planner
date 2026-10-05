import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resumirPasadaAlternativas } from "../salud";

describe("resumirPasadaAlternativas (alc-ac2: la pasada sobrevive al pisado del tick)", () => {
  it("conserva contadores enteros y el último error acotado", () => {
    const resumen = resumirPasadaAlternativas(
      { alternativas_candidatas: 16, alternativas_error_interno: 16, ultimo_error: 'null value in column "x"', nombre: "Museo X" },
      42,
      "abc",
    );
    expect(resumen).toEqual({
      registrada_hace_seg: 42,
      commit_sha: "abc",
      contadores: { alternativas_candidatas: 16, alternativas_error_interno: 16 },
      ultimo_error: 'null value in column "x"',
    });
  });

  it("nunca filtra claves ajenas ni errores de más de 160 caracteres, para cualquier entrada", () => {
    fc.assert(
      fc.property(fc.anything(), fc.string({ maxLength: 400 }), (resultado, error) => {
        const resumen = resumirPasadaAlternativas({ ...(typeof resultado === "object" && resultado ? resultado : {}), ultimo_error: error }, 1, null);
        expect(Object.keys(resumen.contadores).every((clave) => clave.startsWith("alternativas_"))).toBe(true);
        expect(Object.values(resumen.contadores).every(Number.isInteger)).toBe(true);
        expect((resumen.ultimo_error ?? "").length).toBeLessThanOrEqual(160);
      }),
    );
  });
});
