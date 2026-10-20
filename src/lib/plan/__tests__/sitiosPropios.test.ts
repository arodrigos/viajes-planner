import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { errorDeFuncionSitio, limpiarTexto, MENSAJES_SITIO, NOMBRE_MAX, NOMBRE_MIN, NOTA_MAX, validarSitio } from "@/lib/plan/sitiosPropios";

describe("validarSitio (spd-ac1)", () => {
  it("acepta un nombre normal y recorta los espacios", () => {
    expect(validarSitio("  Casa Fassi  ", undefined, true)).toEqual({ nombre: "Casa Fassi", nota: null });
  });

  it("rechaza nombres de 1 y de 81 caracteres, acepta 2 y 80", () => {
    expect(validarSitio("a", null, true)).toEqual({ error: MENSAJES_SITIO.nombre });
    expect(validarSitio("a".repeat(NOMBRE_MAX + 1), null, true)).toEqual({ error: MENSAJES_SITIO.nombre });
    expect("error" in validarSitio("ab", null, true)).toBe(false);
    expect("error" in validarSitio("a".repeat(NOMBRE_MAX), null, true)).toBe(false);
  });

  it("rechaza notas de 201 caracteres y acepta 200", () => {
    expect(validarSitio("Fassi", "x".repeat(NOTA_MAX + 1), true)).toEqual({ error: MENSAJES_SITIO.nota });
    expect(validarSitio("Fassi", "x".repeat(NOTA_MAX), true)).toEqual({ nombre: "Fassi", nota: "x".repeat(NOTA_MAX) });
  });

  it("sin nota permitida (corrección) ignora la que llegue", () => {
    expect(validarSitio("Fassi", "ignorada", false)).toEqual({ nombre: "Fassi", nota: null });
  });

  it("no cuenta un emoji como dos caracteres", () => {
    expect("error" in validarSitio("😀".repeat(NOMBRE_MAX), null, true)).toBe(false);
  });

  it("una nota solo de espacios queda en null", () => {
    expect(validarSitio("Fassi", "   ", true)).toEqual({ nombre: "Fassi", nota: null });
  });
});

describe("errorDeFuncionSitio", () => {
  it("traduce cada error de la función SQL a su estado", () => {
    expect(errorDeFuncionSitio("version-desfasada")?.status).toBe(409);
    expect(errorDeFuncionSitio("demasiados-pendientes")?.status).toBe(429);
    expect(errorDeFuncionSitio("dia-invalido")?.status).toBe(400);
    expect(errorDeFuncionSitio("no-es-propia")?.status).toBe(400);
    expect(errorDeFuncionSitio("sitio-invalido")?.status).toBe(400);
    expect(errorDeFuncionSitio("otra cosa")).toBeNull();
  });
});

describe("invariantes del texto del sitio (propiedad)", () => {
  it("lo que valida nunca lleva caracteres de control ni sale de los límites", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.string({ maxLength: 260 }), (nombre, nota) => {
        const r = validarSitio(nombre, nota, true);
        if ("error" in r) return true;
        const largo = Array.from(r.nombre).length;
        const sinControl = (t: string) => limpiarTexto(t) === t;
        return largo >= NOMBRE_MIN && largo <= NOMBRE_MAX && sinControl(r.nombre) && (r.nota === null || (Array.from(r.nota).length <= NOTA_MAX && sinControl(r.nota)));
      }),
      { numRuns: 300 },
    );
  });
});
