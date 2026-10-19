import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { registrarObsoleto } from "../obsoleto";

const cliente = (rpc: () => Promise<{ data: unknown; error: unknown }>) => ({ rpc }) as never;

describe("registrarObsoleto", () => {
  it("devuelve tal cual los tres resultados de la función", async () => {
    for (const r of ["ok", "repetido", "tope-usuario"]) {
      expect(await registrarObsoleto(cliente(async () => ({ data: r, error: null })), "u", "k")).toBe(r);
    }
  });

  it("cerrado ante el fallo: error, excepción o dato inesperado dan 'error'", async () => {
    expect(await registrarObsoleto(cliente(async () => ({ data: null, error: { message: "x" } })), "u", "k")).toBe("error");
    expect(await registrarObsoleto(cliente(async () => { throw new Error("red"); }), "u", "k")).toBe("error");
    await fc.assert(
      fc.asyncProperty(fc.anything().filter((v) => v !== "ok" && v !== "repetido" && v !== "tope-usuario"), async (dato) => {
        expect(await registrarObsoleto(cliente(async () => ({ data: dato, error: null })), "u", "k")).toBe("error");
      }),
    );
  });
});
