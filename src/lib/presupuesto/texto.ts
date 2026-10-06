// Redacción de la tarjeta y la cabecera, aquí y no en el componente para que
// los textos exactos del criterio se comprueben sin montar la vista.
import { formatearEuros } from "@/lib/formato/numeros";
import type { CosteParada } from "@/lib/plan/tipos";

export function textoPrecioParada(coste: CosteParada | undefined): string {
  if (!coste) return "Sin precio orientativo";
  if (coste.por === "gratis") return "Gratis";
  const origen = coste.procedencia === "estimado" ? "estimado" : "según Wikivoyage";
  const unidad = coste.por === "persona" ? "/persona" : " el grupo";
  // Los enteros pasan por el formateador único (punto de miles y espacio duro); los céntimos
  // de Wikivoyage se mantienen con coma porque formatearEuros redondea.
  const importe = Number.isInteger(coste.importe_eur)
    ? formatearEuros(coste.importe_eur)
    : `${coste.importe_eur.toFixed(2).replace(".", ",")}\u00a0€`;
  return `Precio orientativo: ${importe}${unidad} · ${origen}`;
}

export interface PresupuestoPublico {
  total_eur: number;
  total_estimado_eur: number;
  total_de_fuente_eur: number;
  // etapas-pais: desglose; ausentes en planes calculados antes de este bloque.
  alojamiento_eur?: number;
  traslados_eur?: number;
  actividades_eur?: number;
  // Ausente cuando el trabajo no guarda presupuesto (no debería pasar: es
  // obligatorio en los criterios).
  tu_presupuesto_eur?: number;
}

export function textoCabeceraPresupuesto(p: PresupuestoPublico): { resumen: string; aviso?: string } {
  // etapas-pais: con alojamiento y traslados el total ya no son solo visitas.
  if ((p.alojamiento_eur ?? 0) + (p.traslados_eur ?? 0) > 0) {
    const resumen = `Total estimado: ~${formatearEuros(p.total_eur)} (alojamiento ~${formatearEuros(p.alojamiento_eur ?? 0)}, traslados ~${formatearEuros(p.traslados_eur ?? 0)}, visitas ~${formatearEuros(p.actividades_eur ?? 0)})`;
    if (p.tu_presupuesto_eur === undefined) return { resumen };
    const completo = `${resumen} · Tu presupuesto: ${formatearEuros(p.tu_presupuesto_eur)}`;
    return p.total_eur > p.tu_presupuesto_eur ? { resumen: completo, aviso: `El total estimado supera tu presupuesto en ~${formatearEuros(p.total_eur - p.tu_presupuesto_eur)}` } : { resumen: completo };
  }
  if (p.total_eur === 0) return { resumen: "Sin estimación de gasto en visitas" };
  const visitas =
    p.total_de_fuente_eur === 0
      ? `Visitas: ~${formatearEuros(p.total_eur)} estimados`
      : `Visitas: ~${formatearEuros(p.total_eur)} (${formatearEuros(p.total_estimado_eur)} estimados, ${formatearEuros(p.total_de_fuente_eur)} de fuente)`;
  if (p.tu_presupuesto_eur === undefined) return { resumen: visitas };
  const resumen = `${visitas} · Tu presupuesto: ${formatearEuros(p.tu_presupuesto_eur)}`;
  return p.total_eur > p.tu_presupuesto_eur
    ? { resumen, aviso: `Las visitas estimadas superan tu presupuesto en ~${formatearEuros(p.total_eur - p.tu_presupuesto_eur)}` }
    : { resumen };
}
