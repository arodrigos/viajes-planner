import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import type { Parada, Plan } from "@/lib/plan/tipos";

// Plan propio de cada prueba de protección de las rutas de edición (orden,
// mover-dia, reservas). Se siembra en la pila local del CI, nunca contra DEV.
export const PREFIJO_PLAN_PROTECCION = "plan-prot-";
const FRANJAS = franjasComoArray("Sevilla");

// Todas en la misma franja: así cualquier permutación respeta la regla de que
// las franjas no retroceden y la prueba puede reordenar sin restricciones.
function parada(id: string, lat: number): Parada {
  return {
    id,
    franja_id: "manana",
    nombre: `Sitio ${id}`,
    descripcion: "Descripción de prueba",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "propuesto-sin-verificar" },
    coordenadas: { lat, lon: -5.99 },
  };
}

// Día 1: p1, p2, p3. Día 2: q1.
export function planEdicion(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      { fecha: "2027-03-05", franjas: FRANJAS, paradas: [parada("p1", 37.38), parada("p2", 37.39), parada("p3", 37.4)] },
      { fecha: "2027-03-06", franjas: FRANJAS, paradas: [parada("q1", 37.37)] },
    ],
  };
}

export function idPlanProteccion(fichero: string): string {
  return `${PREFIJO_PLAN_PROTECCION}${fichero}-${Date.now()}`;
}

export async function sembrarPlanEdicion(servicio: SupabaseClient, planId: string, duenyoId: string): Promise<void> {
  await guardarPlan(servicio, planEdicion(planId));
  const { error } = await servicio
    .from("trabajos")
    .insert({ usuario_id: duenyoId, tipo: "generacion", criterios: { destino_o_tipo: "Sevilla" }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

// Borra planes de estas pruebas (también los restos de una ejecución cortada).
// Con `planIds` solo esos; sin él, todo lo que lleve el prefijo.
export async function limpiarPlanesProteccion(servicio: SupabaseClient, planIds?: string[]): Promise<void> {
  let ids = planIds;
  if (!ids) {
    const { data } = await servicio.from("planes").select("id").like("id", `${PREFIJO_PLAN_PROTECCION}%`);
    ids = (data ?? []).map((f) => f.id as string);
  }
  for (const id of ids) {
    await servicio.from("reservas").delete().eq("plan_id", id);
    await servicio.from("trabajos").delete().eq("plan_id", id);
    await servicio.from("planes").delete().eq("id", id);
  }
}

// Paradas de cada día tal como quedaron persistidas.
export async function idsPorDia(servicio: SupabaseClient, planId: string): Promise<string[][]> {
  const plan = await recuperarPlan(servicio, planId);
  if (!plan) throw new Error(`El plan ${planId} no existe`);
  return plan.dias.map((d) => d.paradas.map((p) => p.id));
}

export async function versionPersistida(servicio: SupabaseClient, planId: string): Promise<number> {
  const plan = await recuperarPlan(servicio, planId);
  if (!plan) throw new Error(`El plan ${planId} no existe`);
  return plan.version;
}
