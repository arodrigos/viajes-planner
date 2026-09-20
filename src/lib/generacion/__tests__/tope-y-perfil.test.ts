import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { postProcesarPlan } from "@/lib/generacion/postProcesar";
import type { Parada, Plan } from "@/lib/plan/tipos";

const CRITERIOS_BASE: CriteriosViaje = {
  destino_o_tipo: "Lisboa",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 1,
  personas: [{ edad: 30 }],
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

// Sobreprovisionado a propósito: cinco candidatas en la misma franja, más
// de lo que cualquier tope de perfil admite, para que el recorte sea
// observable.
function planSobreprovisionado(): Plan {
  return {
    id: "plan-test",
    version: 1,
    destino: "Lisboa",
    personas: 1,
    dias: [
      {
        fecha: "2026-05-01",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [parada("a", 90), parada("b", 80), parada("c", 70), parada("d", 60), parada("e", 50)],
      },
    ],
  };
}

describe("tope-y-perfil (generacion-ac1)", () => {
  it("(a) ninguna franja supera el tope, y con tope=1 hay estrictamente menos paradas que con tope=3", () => {
    const conTope1 = postProcesarPlan(planSobreprovisionado(), { ...CRITERIOS_BASE, tope_sitios_por_franja: 1 });
    const conTope3 = postProcesarPlan(planSobreprovisionado(), { ...CRITERIOS_BASE, tope_sitios_por_franja: 3 });

    for (const dia of conTope1.plan.dias) {
      for (const franja of dia.franjas) {
        expect(dia.paradas.filter((p) => p.franja_id === franja.id).length).toBeLessThanOrEqual(1);
      }
    }
    for (const dia of conTope3.plan.dias) {
      for (const franja of dia.franjas) {
        expect(dia.paradas.filter((p) => p.franja_id === franja.id).length).toBeLessThanOrEqual(3);
      }
    }

    const totalTope1 = conTope1.plan.dias.reduce((n, d) => n + d.paradas.length, 0);
    const totalTope3 = conTope3.plan.dias.reduce((n, d) => n + d.paradas.length, 0);
    expect(totalTope1).toBeLessThan(totalTope3);

    // Se conservan las de mayor prioridad, no las primeras del array.
    expect(conTope1.plan.dias[0].paradas.map((p) => p.id)).toEqual(["a"]);
  });

  it("(b) mismos criterios con distinto perfil producen planes con distinto número medio de paradas y distinta mezcla", () => {
    const familiar = postProcesarPlan(planSobreprovisionado(), { ...CRITERIOS_BASE, perfil: "familiar" });
    const pareja = postProcesarPlan(planSobreprovisionado(), { ...CRITERIOS_BASE, perfil: "pareja" });

    const totalFamiliar = familiar.plan.dias.reduce((n, d) => n + d.paradas.length, 0);
    const totalPareja = pareja.plan.dias.reduce((n, d) => n + d.paradas.length, 0);
    expect(totalFamiliar).not.toBe(totalPareja);

    const idsFamiliar = familiar.plan.dias[0].paradas.map((p) => p.id).sort();
    const idsPareja = pareja.plan.dias[0].paradas.map((p) => p.id).sort();
    expect(idsFamiliar).not.toEqual(idsPareja);
  });
});
