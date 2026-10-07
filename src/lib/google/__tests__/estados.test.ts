import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { estadoDeFila } from "../estados";

describe("estadoDeFila", () => {
  it("sin lugar comprobado no hay ubicación; obsoleto y error vuelven a pendiente", () => {
    expect(estadoDeFila(false, "casado")).toBe("sin-ubicacion");
    expect(estadoDeFila(true, undefined)).toBe("pendiente");
    expect(estadoDeFila(true, "obsoleto")).toBe("pendiente");
    expect(estadoDeFila(true, "error")).toBe("pendiente");
    expect(estadoDeFila(true, "casado")).toBe("casado");
    expect(estadoDeFila(true, "sin-coincidencia")).toBe("sin-coincidencia");
  });

  it("una parada sin comprobar nunca sale como casada", () => {
    fc.assert(fc.property(fc.option(fc.string(), { nil: undefined }), (estado) => estadoDeFila(false, estado) === "sin-ubicacion"));
  });
});
