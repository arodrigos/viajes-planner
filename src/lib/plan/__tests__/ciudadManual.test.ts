import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recortarNombrePedido } from "../ciudadManual";

// man-ac2/man-ac4 (límites) e invariante del diseño: para CUALQUIER
// entrada de texto, el nombre pedido se guarda recortado y con un máximo
// de 80 caracteres -- property test, no un puñado de ejemplos elegidos a
// mano.
describe("recortarNombrePedido (invariante ciudad-a-mano)", () => {
  it("nunca supera 80 caracteres y nunca lleva espacios en los extremos", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (crudo) => {
        const recortado = recortarNombrePedido(crudo);
        expect(recortado.length).toBeLessThanOrEqual(80);
        expect(recortado).toBe(recortado.trim());
      }),
    );
  });

  it("un texto solo de espacios se recorta a una cadena vacía", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(" ", "\t", "\n"), { maxLength: 50 }), (caracteres) => {
        expect(recortarNombrePedido(caracteres.join(""))).toBe("");
      }),
    );
  });

  it("un nombre de 500 caracteres se recorta a 80", () => {
    expect(recortarNombrePedido("a".repeat(500))).toHaveLength(80);
  });
});
