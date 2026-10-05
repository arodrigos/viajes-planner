// Redacción de la tarjeta y la cabecera, aquí y no en el componente para que
// los textos exactos del criterio se comprueben sin montar la vista.
import type { CosteParada } from "@/lib/plan/tipos";

export function formatearEuros(importe: number): string {
  return `${Math.round(importe).toLocaleString("es-ES")} €`;
}

export function textoPrecioParada(coste: CosteParada | undefined): string {
  if (!coste) return "Sin precio orientativo";
  if (coste.por === "gratis") return "Gratis";
  const origen = coste.procedencia === "estimado" ? "estimado" : "Wikivoyage";
  const unidad = coste.por === "persona" ? "/persona" : " el grupo";
  const importe = Number.isInteger(coste.importe_eur) ? String(coste.importe_eur) : coste.importe_eur.toFixed(2).replace(".", ",");
  return `Precio orientativo: ${importe} €${unidad} · ${origen}`;
}

export interface PresupuestoPublico {
  total_eur: number;
  total_estimado_eur: number;
  total_de_fuente_eur: number;
  // Ausente cuando el trabajo no guarda presupuesto (no debería pasar: es
  // obligatorio en los criterios).
  tu_presupuesto_eur?: number;
}

export function textoCabeceraPresupuesto(p: PresupuestoPublico): { resumen: string; aviso?: string } {
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
