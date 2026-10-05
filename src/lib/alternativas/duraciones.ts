// alt-ac3: rango de duración típico por categoría. Sustituye al ±30 % de
// la duración que estimó el propio modelo, que descartaba casi todas las
// alternativas reales (un museo de 120 min nunca "se parecía" a uno que el
// modelo había estimado en 60).
import type { CategoriaParada } from "@/lib/plan/tipos";

export interface RangoDuracion {
  min: number;
  max: number;
}

export const DURACION_POR_CATEGORIA: Record<CategoriaParada, RangoDuracion> = {
  monumento: { min: 30, max: 120 },
  museo: { min: 45, max: 180 },
  parque: { min: 30, max: 150 },
  mirador: { min: 15, max: 60 },
  barrio: { min: 45, max: 180 },
  plaza: { min: 15, max: 60 },
  mercado: { min: 30, max: 120 },
  playa: { min: 60, max: 240 },
  naturaleza: { min: 60, max: 300 },
  "ocio-infantil": { min: 60, max: 180 },
  espectaculo: { min: 60, max: 180 },
  comida: { min: 45, max: 120 },
  compras: { min: 30, max: 150 },
  otro: { min: 30, max: 180 },
};

// Un cercano de Overpass no trae duración: hereda la de la parada, acotada
// al rango de su categoría para que cumpla el mismo contrato que una
// alternativa que pasó por esEquivalente.
export function duracionParaCercano(categoria: CategoriaParada, duracionParada: number): number {
  const { min, max } = DURACION_POR_CATEGORIA[categoria];
  return Math.min(max, Math.max(min, duracionParada));
}
