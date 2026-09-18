import { describe, expect, it } from "vitest";
import { validarPlan } from "@/lib/plan/validar";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import type { Plan } from "@/lib/plan/tipos";

function clonar(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan));
}

describe("validarPlan", () => {
  it("acepta un plan válido", () => {
    const resultado = validarPlan(planFixture);
    expect(resultado.valido).toBe(true);
    expect(resultado.errores).toEqual([]);
  });

  it("rechaza una parada fuera de toda franja", () => {
    const plan = clonar(planFixture);
    plan.dias[0].paradas[0].franja_id = "franja-inexistente";
    const resultado = validarPlan(plan);
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.some((e) => e.ruta.includes("franja_id"))).toBe(true);
  });

  it("rechaza una prioridad fuera de 0-100", () => {
    const plan = clonar(planFixture);
    plan.dias[0].paradas[0].prioridad = 150;
    const resultado = validarPlan(plan);
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.some((e) => e.ruta.includes("prioridad"))).toBe(true);
  });

  it("rechaza hora_fin anterior a hora_inicio", () => {
    const plan = clonar(planFixture);
    plan.dias[0].franjas[0].hora_fin = "00:00";
    plan.dias[0].franjas[0].hora_inicio = "10:00";
    const resultado = validarPlan(plan);
    expect(resultado.valido).toBe(false);
    expect(resultado.errores.some((e) => e.ruta.includes("hora_fin"))).toBe(true);
  });
});
