import type { CriteriosViaje } from "./tipos";

// Persistir el borrador en el propio navegador (no hay nada que encolar
// todavía: este bloque es pantalla y validación) es lo que permite
// recargar sin perder lo escrito, sin necesidad de sesión ni de red.
const CLAVE = "viajes-planner:criterios-borrador";

export function guardarBorrador(criterios: CriteriosViaje): void {
  window.localStorage.setItem(CLAVE, JSON.stringify(criterios));
}

export function leerBorrador(): CriteriosViaje | null {
  const crudo = window.localStorage.getItem(CLAVE);
  if (!crudo) return null;
  try {
    return JSON.parse(crudo) as CriteriosViaje;
  } catch {
    return null;
  }
}
