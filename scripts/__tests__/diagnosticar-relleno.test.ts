import { describe, expect, it } from "vitest";
import { CONSULTA_DIAGNOSTICO, construirResumen, extraerJson } from "@/lib/trabajador/diagnosticoRelleno";

// rel-ac6: la salida del diagnóstico solo contiene recuentos y claves de lista cerrada.
describe("diagnóstico del relleno (rel-ac6)", () => {
  it("la consulta es de solo lectura y no proyecta destinos, nombres ni ids", () => {
    expect(CONSULTA_DIAGNOSTICO).toMatch(/begin read only/);
    expect(CONSULTA_DIAGNOSTICO).not.toMatch(/\bdestino\b|pa\.nombre|\binsert\b|\bupdate\b|\bdelete\b/i);
  });

  it("agrega recuentos y colapsa texto libre a «otro»", () => {
    const resumen = construirResumen({
      planes_por_ciudad: [
        { estado: "resuelta", categoria_motivo: "ninguna", version_resolutor: "7", n: "3" },
        { estado: "Lisboa secreta", categoria_motivo: "x@y.com", version_resolutor: "sin-version", n: 2 },
      ],
      paradas_pendientes_por_estado_plan: [{ estado_plan: "multiciudad", n: 5 }, { estado_plan: "Madrid", n: -1 }],
    });
    expect(resumen.planes_por_ciudad[0]).toEqual({ estado: "resuelta", categoria_motivo: "ninguna", version_resolutor: 7, planes: 3 });
    expect(resumen.planes_por_ciudad[1]).toEqual({ estado: "otro", categoria_motivo: "otro", version_resolutor: "sin-version", planes: 2 });
    expect(resumen.paradas_pendientes_por_estado_plan).toEqual([
      { estado_plan: "multiciudad", paradas: 5 },
      { estado_plan: "otro", paradas: 0 },
    ]);
    expect(JSON.stringify(resumen)).not.toMatch(/Lisboa|Madrid|@/);
  });

  it("tolera entradas vacías o malformadas y extrae la línea JSON de psql", () => {
    expect(construirResumen(null)).toEqual({ planes_por_ciudad: [], paradas_pendientes_por_estado_plan: [] });
    expect(extraerJson("BEGIN\n{\"planes_por_ciudad\":[]}\nROLLBACK\n")).toEqual({ planes_por_ciudad: [] });
    expect(extraerJson("BEGIN\n")).toEqual({});
  });
});
