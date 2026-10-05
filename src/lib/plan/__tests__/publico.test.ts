import { describe, expect, it } from "vitest";
import { aPlanPublico } from "@/lib/plan/publico";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";

describe("aPlanPublico", () => {
  it("no serializa hora_inicio ni hora_fin de ninguna franja", () => {
    const publico = aPlanPublico(planFixture);
    const json = JSON.stringify(publico);
    expect(json).not.toContain("hora_inicio");
    expect(json).not.toContain("hora_fin");
  });

  it("conserva el resto del plan intacto", () => {
    const publico = aPlanPublico(planFixture);
    expect(publico.dias).toHaveLength(planFixture.dias.length);
    // El horario es lo único que la serialización añade a cada parada (horario-local).
    expect(publico.dias[0].paradas.map((p) => ({ ...p, horario: undefined }))).toEqual(planFixture.dias[0].paradas);
    expect(publico.dias[0].franjas[0]).toEqual({
      id: planFixture.dias[0].franjas[0].id,
      etiqueta: planFixture.dias[0].franjas[0].etiqueta,
    });
  });
});
