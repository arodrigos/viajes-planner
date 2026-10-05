import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATEGORIAS_RESULTADO, categorizarResultado, construirSalud, resumirResultadoPublico } from "@/lib/salud";

// cam-ac4
describe("categorizarResultado", () => {
  it.each([
    [{ ok: true }, "ok"],
    [{ ok: false, error: "fetch failed: ETIMEDOUT" }, "red"],
    [{ ok: false, error: "HTTP 429 Too Many Requests" }, "cuota"],
    [{ ok: false, error: "el modelo devolvió JSON inválido" }, "modelo"],
    [{ ok: false, error: "PGRST116 de PostgREST" }, "base-de-datos"],
    [{ ok: false, error: "Nominatim 503 al buscar Lisboa" }, "fuente-externa"],
    [{ ok: false, error: "algo raro" }, "desconocido"],
    [null, "desconocido"],
  ])("%j → %s", (entrada, esperado) => {
    expect(categorizarResultado(entrada)).toBe(esperado);
  });

  it("siempre devuelve un valor de la lista cerrada y el texto del error no se publica", () => {
    fc.assert(
      fc.property(fc.anything(), fc.string({ minLength: 4 }), (cualquiera, texto) => {
        expect(CATEGORIAS_RESULTADO).toContain(categorizarResultado(cualquiera));
        const publico = JSON.stringify(
          construirSalud({
            trabajadorVistoHaceSeg: 1,
            trabajadorUltimoResultado: { ok: false, trabajos_procesados: 0, planes_mirados: 0, paradas_intentadas: 0, error: texto },
          }).trabajador,
        );
        // Un trozo de texto que ya forma parte de las claves o categorías fijas no cuenta.
        const fijo = JSON.stringify(resumirResultadoPublico({ ok: false, trabajos_procesados: 0, planes_mirados: 0, paradas_intentadas: 0 }));
        if (!fijo.includes(texto) && !"visto_hace_seg ultimo_resultado commit_sha".includes(texto)) {
          expect(publico).not.toContain(JSON.stringify(texto).slice(1, -1));
        }
      }),
    );
  });
});

// alc-ac2: los contadores de la pasada de alternativas salen enteros y nada más.
describe("resumirResultadoPublico con contadores de alternativas", () => {
  it("publica solo los contadores enteros de la lista blanca", () => {
    const publico = resumirResultadoPublico({
      ok: true,
      trabajos_procesados: 0,
      planes_mirados: 0,
      paradas_intentadas: 0,
      alternativas_candidatas: 16,
      alternativas_intentadas: 12,
      alternativas_con_cercanos: 0,
      alternativas_sin_datos: 4,
      alternativas_fallo_fuente: 1,
      alternativas_error_interno: 0,
      alternativas_texto: "Lisboa",
    } as never);
    expect(publico).toMatchObject({
      alternativas_candidatas: 16,
      alternativas_intentadas: 12,
      alternativas_con_cercanos: 0,
      alternativas_sin_datos: 4,
      alternativas_fallo_fuente: 1,
      alternativas_error_interno: 0,
    });
    expect(JSON.stringify(publico)).not.toContain("Lisboa");
  });
});
