import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CATEGORIAS_RESULTADO, resumirPasadaAlternativas } from "../salud";

describe("resumirPasadaAlternativas (alc-ac2: la pasada sobrevive al pisado del tick)", () => {
  it("conserva contadores enteros y publica la categoría del último error, no su texto", () => {
    const resumen = resumirPasadaAlternativas(
      { alternativas_candidatas: 16, alternativas_error_interno: 16, ultimo_error: 'null value in column "x"', nombre: "Museo X" },
      42,
      "abc",
    );
    expect(resumen).toEqual({
      registrada_hace_seg: 42,
      commit_sha: "abc",
      contadores: { alternativas_candidatas: 16, alternativas_error_interno: 16 },
      ultimo_error_categoria: "desconocido",
    });
  });

  it("un error de PostgREST con consulta y URL interna sale solo como categoría (#123)", () => {
    const crudo = 'PGRST116: select * from viajes_planner.paradas where id = eq.abc https://interno.supabase.co/rest/v1';
    const resumen = resumirPasadaAlternativas({ ultimo_error: crudo }, 1, null);
    expect(resumen.ultimo_error_categoria).toBe("base-de-datos");
    expect(JSON.stringify(resumen)).not.toContain("viajes_planner.paradas");
    expect(JSON.stringify(resumen)).not.toContain("https://");
  });

  it("nunca filtra claves ajenas ni texto del error, para cualquier entrada", () => {
    fc.assert(
      fc.property(fc.anything(), fc.string({ maxLength: 400 }), (resultado, error) => {
        const resumen = resumirPasadaAlternativas({ ...(typeof resultado === "object" && resultado ? resultado : {}), ultimo_error: error }, 1, null);
        expect(Object.keys(resumen.contadores).every((clave) => clave.startsWith("alternativas_"))).toBe(true);
        expect(Object.values(resumen.contadores).every(Number.isInteger)).toBe(true);
        expect(resumen.ultimo_error_categoria === null || CATEGORIAS_RESULTADO.includes(resumen.ultimo_error_categoria)).toBe(true);
        expect(Object.keys(resumen)).not.toContain("ultimo_error");
      }),
    );
  });
});
