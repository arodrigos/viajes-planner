import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ERRORES_VACIOS, fijarError, leerError, limpiarError, type ErroresParada, type ErrorParada } from "../erroresParada";

const idParada = fc.constantFrom("a", "b", "c", "d");
const error = fc.record({ tipo: fc.constantFrom<ErrorParada["tipo"]>("cambio", "visita"), mensaje: fc.string({ minLength: 1 }) });
const operacion = fc.oneof(
  fc.record({ op: fc.constant("fijar" as const), id: idParada, error }),
  fc.record({ op: fc.constant("limpiar" as const), id: idParada }),
);
type Operacion = { op: "fijar"; id: string; error: ErrorParada } | { op: "limpiar"; id: string };

function aplicar(ops: Operacion[]): ErroresParada {
  return ops.reduce<ErroresParada>((e, o) => (o.op === "fijar" ? fijarError(e, o.id, o.error) : limpiarError(e, o.id)), ERRORES_VACIOS);
}

// err-ac3
describe("erroresParada (err-ac3)", () => {
  it("leer(Z) solo depende de las operaciones hechas sobre Z", () => {
    fc.assert(
      fc.property(fc.array(operacion), idParada, (ops, z) => {
        const todas = leerError(aplicar(ops), z);
        const soloZ = leerError(aplicar(ops.filter((o) => o.id === z)), z);
        expect(todas).toEqual(soloZ);
      }),
      { numRuns: 100 },
    );
  });

  it("tras limpiar(X) leer(X) es undefined; fijar(X, e) y leer(X) devuelve e", () => {
    fc.assert(
      fc.property(fc.array(operacion), idParada, error, (ops, x, e) => {
        const base = aplicar(ops);
        expect(leerError(limpiarError(base, x), x)).toBeUndefined();
        expect(leerError(fijarError(base, x, e), x)).toEqual(e);
      }),
      { numRuns: 100 },
    );
  });

  it("no muta el Map de entrada", () => {
    const base = fijarError(ERRORES_VACIOS, "a", { tipo: "cambio", mensaje: "x" });
    fijarError(base, "b", { tipo: "visita", mensaje: "y" });
    limpiarError(base, "a");
    expect([...base.keys()]).toEqual(["a"]);
  });
});
