import { describe, expect, it } from "vitest";
import type { DragEndEvent } from "@dnd-kit/react";
import { aplicarSoltar } from "../arrastre";

const evento = (fuente: Record<string, unknown>, target: unknown = null, canceled = false) =>
  ({ operation: { source: fuente, target, canceled } }) as unknown as DragEndEvent;

const grupos = () => ({ manana: ["a", "b", "c"], tarde: ["d"] });

describe("aplicarSoltar", () => {
  it("usa el índice final de la fuente aunque el destino llegue nulo", () => {
    const nuevo = aplicarSoltar(grupos(), evento({ id: "c", initialGroup: "manana", group: "manana", initialIndex: 2, index: 0 }));
    expect(nuevo).toEqual({ manana: ["c", "a", "b"], tarde: ["d"] });
  });

  it("cambia de franja cuando el grupo final es otro", () => {
    const nuevo = aplicarSoltar(grupos(), evento({ id: "c", initialGroup: "manana", group: "tarde", initialIndex: 2, index: 0 }));
    expect(nuevo).toEqual({ manana: ["a", "b"], tarde: ["c", "d"] });
  });

  it("sin cambio de puesto devuelve la misma colocación", () => {
    const nuevo = aplicarSoltar(grupos(), evento({ id: "b", initialGroup: "manana", group: "manana", initialIndex: 1, index: 1 }));
    expect(nuevo).toEqual(grupos());
  });

  it("ignora una fuente cuyo índice inicial no corresponde a su id", () => {
    const nuevo = aplicarSoltar(grupos(), evento({ id: "z", initialGroup: "manana", group: "manana", initialIndex: 2, index: 0 }, null, true));
    expect(nuevo).toEqual(grupos());
  });
});
