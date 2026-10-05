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
  // total = alojamiento + traslados + actividades. Sin etapas (una sola
  // ciudad), alojamiento y traslados son 0 y el total son las visitas.
  total_eur: number;
  alojamiento_eur: number;
  traslados_eur: number;
  actividades_eur: number;
  total_estimado_eur: number;
  total_de_fuente_eur: number;
}

// Se suma en céntimos enteros: con euros en coma flotante, la suma por día
// y la total podrían diferir en el último decimal según el orden, y los
// invariantes exigen igualdad.
function aCentimos(euros: number): number {
  return Math.round(euros * 100);
}

export function calcularPresupuesto(plan: Pick<Plan, "personas" | "dias" | "etapas" | "traslados">): Presupuesto {
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

  // Alojamiento y traslados son siempre estimaciones del sistema; se duerme
  // una noche menos que días de viaje (la última etapa no pernocta el último día).
  const etapas = plan.etapas ?? [];
  const alojamientoCentimos = etapas.reduce((suma, e, i) => suma + (i === etapas.length - 1 ? Math.max(0, e.dias - 1) : e.dias) * aCentimos(e.alojamiento_noche_eur), 0);
  const trasladosCentimos = (plan.traslados ?? []).reduce((suma, t) => suma + aCentimos(t.coste_eur), 0);
  const total = totalCentimos + alojamientoCentimos + trasladosCentimos;
  const estimado = estimadoCentimos + alojamientoCentimos + trasladosCentimos;

  return {
    por_dia: porDia,
    total_eur: total / 100,
    alojamiento_eur: alojamientoCentimos / 100,
    traslados_eur: trasladosCentimos / 100,
    actividades_eur: totalCentimos / 100,
    total_estimado_eur: estimado / 100,
    total_de_fuente_eur: (total - estimado) / 100,
  };
}
