import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AVISO_REENVIO_RED, AVISO_REENVIO_SERVIDOR, mensajeFalloReenvio } from "./avisoReenvio";

describe("mensajeFalloReenvio", () => {
  it("cualquier status de error da el mismo aviso de servidor", () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), (status) => {
        expect(mensajeFalloReenvio({ tipo: "respuesta", status })).toBe(AVISO_REENVIO_SERVIDOR);
      }),
    );
  });

  it("sin red da su propio aviso, y ninguno habla de límites, autorizaciones ni del correo", () => {
    expect(mensajeFalloReenvio({ tipo: "red" })).toBe(AVISO_REENVIO_RED);
    expect(AVISO_REENVIO_RED).not.toBe(AVISO_REENVIO_SERVIDOR);
    for (const texto of [AVISO_REENVIO_RED, AVISO_REENVIO_SERVIDOR]) {
      expect(texto).not.toMatch(/límite|autoriz|correo electr|@/i);
    }
  });
});
