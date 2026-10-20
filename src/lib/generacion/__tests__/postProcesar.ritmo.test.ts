import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { postProcesarPlan } from "@/lib/generacion/postProcesar";
import type { Parada, Plan } from "@/lib/plan/tipos";

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Lisboa",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 1,
  personas: [{ edad: 30 }, { edad: 6 }],
  perfil: "familiar",
  presupuesto_eur: 1000,
};

function parada(id: string, prioridad: number): Parada {
  return {
    id,
    franja_id: "manana",
    nombre: `Parada ${id}`,
    descripcion: `Descripción de la parada ${id}, sin categoría de riesgo.`,
    duracion_min: 60,
    prioridad,
    procedencia: { fuente: "propuesto-sin-verificar" },
  };
}

function plan3EnUnaFranja(): Plan {
  return {
    id: "plan-ritmo",
    version: 1,
    destino: "Lisboa",
    personas: 2,
    dias: [
      {
        fecha: "2026-05-01",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [parada("a", 90), parada("b", 80), parada("c", 70)],
      },
    ],
  };
}

describe("postProcesarPlan con ritmo (rit-ac2)", () => {
  const enLaFranja = (p: Plan) => p.dias[0].paradas.filter((x) => x.franja_id === "manana").length;

  it("familiar tranquilo deja 1 parada por franja; sin ritmo, 2; intenso, 3", () => {
    expect(enLaFranja(postProcesarPlan(plan3EnUnaFranja(), { ...CRITERIOS, ritmo: "tranquilo" }).plan)).toBe(1);
    expect(enLaFranja(postProcesarPlan(plan3EnUnaFranja(), CRITERIOS).plan)).toBe(2);
    expect(enLaFranja(postProcesarPlan(plan3EnUnaFranja(), { ...CRITERIOS, ritmo: "intenso" }).plan)).toBe(3);
  });

  it("se queda con la de más prioridad", () => {
    const { plan } = postProcesarPlan(plan3EnUnaFranja(), { ...CRITERIOS, ritmo: "tranquilo" });
    expect(plan.dias[0].paradas.map((p) => p.id)).toEqual(["a"]);
  });
});
