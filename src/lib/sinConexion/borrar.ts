import { CACHE_DATOS, CACHE_FOTOS } from "./reglas";

// Nunca lanzan: borrar la copia es una limpieza de privacidad y no puede
// bloquear el cierre de sesión ni dejar un botón colgado si la Cache API no
// existe (http sin contexto seguro, navegador sin soporte) o falla.
export async function borrarCopias(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await Promise.all([caches.delete(CACHE_DATOS), caches.delete(CACHE_FOTOS)]);
  } catch {
    // Sin Cache API utilizable tampoco hay copia que enseñar.
  }
}

// Solo se quita el JSON del plan: las fotos son de Commons, compartidas entre
// planes, y caducan solas a los 30 días.
export async function borrarCopiaPlan(planId: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    if (!(await caches.has(CACHE_DATOS))) return;
    const cache = await caches.open(CACHE_DATOS);
    await cache.delete(new URL(`/api/plan/${encodeURIComponent(planId)}`, location.origin).href);
  } catch {
    // Igual que arriba.
  }
}
