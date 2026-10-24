import { colaDeSalida } from "@/lib/gastos/cola";
import { borrarMapasPlan } from "./mapas";
import { CACHE_DATOS, CACHE_FOTOS, CACHE_MAPA } from "./reglas";

async function vaciarCola(vaciar: () => Promise<void>): Promise<void> {
  try {
    await vaciar();
  } catch {
    // Sin IndexedDB utilizable tampoco hay cola que vaciar.
  }
}

// Nunca lanzan: borrar la copia es una limpieza de privacidad y no puede
// bloquear el cierre de sesión ni dejar un botón colgado si la Cache API no
// existe (http sin contexto seguro, navegador sin soporte) o falla.
// Con conservarGastos (tras entrar con el código) lo apuntado sin conexión sigue
// en la cola: una sesión caducada no puede costar los gastos que no se subieron.
export async function borrarCopias(opciones: { conservarGastos?: boolean } = {}): Promise<void> {
  if (!opciones.conservarGastos) await vaciarCola(() => colaDeSalida().vaciarTodo());
  if (typeof caches === "undefined") return;
  try {
    await Promise.all([caches.delete(CACHE_DATOS), caches.delete(CACHE_FOTOS), caches.delete(CACHE_MAPA)]);
  } catch {
    // Sin Cache API utilizable tampoco hay copia que enseñar.
  }
}

// Se quita el JSON del plan y su índice de mapa: las fotos son de Commons,
// compartidas entre planes, y caducan solas a los 30 días.
export async function borrarCopiaPlan(planId: string): Promise<void> {
  await vaciarCola(() => colaDeSalida().vaciarAmbito(planId));
  if (typeof caches === "undefined") return;
  await borrarMapasPlan(planId);
  try {
    if (!(await caches.has(CACHE_DATOS))) return;
    const cache = await caches.open(CACHE_DATOS);
    await cache.delete(new URL(`/api/plan/${encodeURIComponent(planId)}`, location.origin).href);
  } catch {
    // Igual que arriba.
  }
}
