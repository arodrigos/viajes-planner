import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { inferirCategoria } from "@/lib/alternativas/categorizar";
import { CATEGORIAS_PARADA } from "@/lib/plan/tipos";

describe("inferirCategoria", () => {
  it.each([
    ["Borough Market", undefined, "mercado"],
    ["Greenwich Park", undefined, "parque"],
    ["Museo de la Ciencia", undefined, "museo"],
    ["Natural History Museum", undefined, "museo"],
    ["Museo del Parque", undefined, "museo"],
    ["Knightsbridge", undefined, null],
    ["Buckingham", undefined, null],
    ["Knightsbridge", { clasificacion_osm: "place=suburb" }, "barrio"],
    ["Algo sin pista", { clasificacion_osm: "historic=castle" }, "monumento"],
    ["Tienda Foo", { clasificacion_osm: "shop=gift" }, "compras"],
    ["Greenwich Park", { clasificacion_osm: "highway=pedestrian" }, "parque"],
  ] as const)("%s %j -> %s", (nombre, etiquetas, esperada) => {
    expect(inferirCategoria(nombre, etiquetas)).toBe(esperada);
  });

  it("para cualquier nombre y clasificación devuelve null o una categoría del enum, sin lanzar", () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: undefined }), (nombre, clasificacion) => {
        const resultado = inferirCategoria(nombre, clasificacion === undefined ? undefined : { clasificacion_osm: clasificacion });
        expect(resultado === null || (CATEGORIAS_PARADA as readonly string[]).includes(resultado)).toBe(true);
      }),
    );
  });
});
