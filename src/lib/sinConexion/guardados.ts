import { CACHE_DATOS, idDeClavePlan } from "./reglas";

export interface PlanGuardado {
  id: string;
  destino: string;
  desde: string;
  hasta: string;
}

// Lee la propia caché del navegador: sin servidor ni sesión. Solo cuentan las
// claves con forma de /api/plan/<id>; cualquier otra cosa que hubiera ahí se
// ignora en vez de pintarse.
export async function listarPlanesGuardados(): Promise<PlanGuardado[]> {
  if (typeof caches === "undefined" || !(await caches.has(CACHE_DATOS))) return [];
  const cache = await caches.open(CACHE_DATOS);
  const salida: PlanGuardado[] = [];
  for (const peticion of await cache.keys()) {
    const id = idDeClavePlan(peticion.url);
    if (!id) continue;
    try {
      const respuesta = await cache.match(peticion);
      const plan = (await respuesta?.json()) as { destino?: unknown; dias?: Array<{ fecha?: unknown }> } | undefined;
      const fechas = (plan?.dias ?? []).map((d) => d.fecha).filter((f): f is string => typeof f === "string");
      if (typeof plan?.destino !== "string" || fechas.length === 0) continue;
      salida.push({ id, destino: plan.destino, desde: fechas[0], hasta: fechas[fechas.length - 1] });
    } catch {
      // Una entrada ilegible no tira la lista entera.
    }
  }
  return salida.sort((a, b) => a.desde.localeCompare(b.desde));
}

export async function existeCopia(id: string): Promise<boolean> {
  if (typeof caches === "undefined" || !(await caches.has(CACHE_DATOS))) return false;
  const cache = await caches.open(CACHE_DATOS);
  return (await cache.keys()).some((p) => idDeClavePlan(p.url) === id);
}
