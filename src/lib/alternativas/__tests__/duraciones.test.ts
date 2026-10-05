import { describe, expect, it } from "vitest";
import { DURACION_POR_CATEGORIA, duracionParaCercano } from "@/lib/alternativas/duraciones";

describe("duracionParaCercano", () => {
  it("acota al rango de la categoría y no devuelve NaN con una duración ausente", () => {
    expect(duracionParaCercano("museo", 60)).toBe(60);
    expect(duracionParaCercano("museo", 500)).toBe(DURACION_POR_CATEGORIA.museo.max);
    expect(duracionParaCercano("museo", Number.NaN)).toBe(DURACION_POR_CATEGORIA.museo.min);
    expect(duracionParaCercano("museo", undefined as unknown as number)).toBe(DURACION_POR_CATEGORIA.museo.min);
  });
});
