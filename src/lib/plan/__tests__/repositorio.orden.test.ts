import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { compararParadasDelDia } = await import("../repositorio");

// El comparador anterior a la columna `orden`, copiado tal cual: la invariante
// es que con orden nulo en todas las filas sale exactamente el mismo orden.
function comparadorAnterior(ordenFranja: Map<string, number>) {
  return (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const ordenA = ordenFranja.get(a.franja_id as string) ?? Number.MAX_SAFE_INTEGER;
    const ordenB = ordenFranja.get(b.franja_id as string) ?? Number.MAX_SAFE_INTEGER;
    if (ordenA !== ordenB) return ordenA - ordenB;
    return (a.id_externo as string).localeCompare(b.id_externo as string);
  };
}

const franjas = new Map([["manana", 0], ["comida", 1], ["tarde", 2]]);

describe("compararParadasDelDia (reo-ac8)", () => {
  it("con orden nulo o ausente coincide con el orden de antes, para cualquier conjunto de paradas", () => {
    const fila = fc.record({
      id_externo: fc.string({ minLength: 1, maxLength: 6 }),
      franja_id: fc.constantFrom("manana", "comida", "tarde", "desconocida"),
      orden: fc.constantFrom(null, undefined),
    });
    fc.assert(
      fc.property(fc.array(fila, { maxLength: 12 }), (filas) => {
        const nuevo = [...filas].sort(compararParadasDelDia(franjas)).map((f) => `${f.franja_id}/${f.id_externo}`);
        const viejo = [...filas].sort(comparadorAnterior(franjas)).map((f) => `${f.franja_id}/${f.id_externo}`);
        expect(nuevo).toEqual(viejo);
      }),
    );
  });

  it("dentro de una franja manda orden y los nulos van al final", () => {
    const filas = [
      { id_externo: "a", franja_id: "manana", orden: null },
      { id_externo: "b", franja_id: "manana", orden: 1 },
      { id_externo: "c", franja_id: "manana", orden: 0 },
      { id_externo: "d", franja_id: "tarde", orden: 0 },
    ];
    expect([...filas].sort(compararParadasDelDia(franjas)).map((f) => f.id_externo)).toEqual(["c", "b", "a", "d"]);
  });
});
