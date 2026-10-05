// Reglas de reparto de un viaje en etapas. Las comparten la comprobación
// previa (viabilidad.ts) y la validación posterior del plan que proponga el
// modelo: una sola fuente evita que una descarte lo que la otra aceptaría.

export const MAX_ETAPAS = 6;
// Menos de 3 días por ciudad es pasar el viaje en trenes y maletas.
export const DIAS_POR_ETAPA = 3;

export function maxEtapas(dias: number): number {
  return Math.min(MAX_ETAPAS, Math.max(1, Math.ceil(dias / DIAS_POR_ETAPA)));
}

// Se duerme una noche menos que días de viaje.
export function nochesDe(dias: number): number {
  return Math.max(0, dias - 1);
}
