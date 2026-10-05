// motivo-y-presupuesto (mot-ac2): las sumas las hace el sistema, nunca el
// modelo. Puro y sin dependencias de servidor: lo usan publico.ts (servidor)
// y los tests de invariantes.
import type { Plan } from "@/lib/plan/tipos";

export interface PresupuestoDia {
  fecha: string;
  total_eur: number;
}

export interface Presupuesto {
  por_dia: PresupuestoDia[];
  total_eur: number;
  total_estimado_eur: number;
  total_de_fuente_eur: number;
}

// Se suma en céntimos enteros: con euros en coma flotante, la suma por día
// y la total podrían diferir en el último decimal según el orden, y los
// invariantes exigen igualdad.
function aCentimos(euros: number): number {
  return Math.round(euros * 100);
}

export function calcularPresupuesto(plan: Pick<Plan, "personas" | "dias">): Presupuesto {
  let totalCentimos = 0;
  let estimadoCentimos = 0;
  const porDia: PresupuestoDia[] = [];

  for (const dia of plan.dias) {
    let diaCentimos = 0;
    for (const parada of dia.paradas) {
      const coste = parada.coste;
      if (!coste) continue;
      const multiplicador = coste.por === "persona" ? plan.personas : 1;
      const centimos = aCentimos(coste.importe_eur) * multiplicador;
      diaCentimos += centimos;
      if (coste.procedencia === "estimado") estimadoCentimos += centimos;
    }
    totalCentimos += diaCentimos;
    porDia.push({ fecha: dia.fecha, total_eur: diaCentimos / 100 });
  }

  return {
    por_dia: porDia,
    total_eur: totalCentimos / 100,
    total_estimado_eur: estimadoCentimos / 100,
    total_de_fuente_eur: (totalCentimos - estimadoCentimos) / 100,
  };
}
