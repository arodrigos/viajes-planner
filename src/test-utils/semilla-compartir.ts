import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

export const NOTA_SEMILLA = "ir a merendar";
export const PRECIO_SEMILLA = 12;
export const PRESUPUESTO_SEMILLA = 4000;
export const ALOJAMIENTO_SEMILLA = "Calle Reservada 7";

// Plan con todo lo que el miembro no debe ver (presupuesto, coste de
// alojamiento, ancla, traslado con coste) y lo que sí (una parada propia con
// nota y otra con precio de entrada).
export function planSemilla(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    etapas: [{ ciudad: { estado: "resuelta", nombre: "Sevilla", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 0, alojamiento_noche_eur: 140, zona: 0, ajustes: [] }],
    traslados: [{ desde: "Madrid", hasta: "Sevilla", modo: "tren", distancia_km: 530, duracion_min: 150, coste_eur: 85, procedencia: "estimado" }],
    dias: [
      {
        fecha: "2027-03-05",
        etapa: 0,
        ancla_alojamiento: { tipo: "usuario", direccion: ALOJAMIENTO_SEMILLA },
        franjas: FRANJAS,
        paradas: [
          { id: "a", franja_id: "manana", nombre: "Catedral", descripcion: "Visita", duracion_min: 90, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" }, coste: { importe_eur: PRECIO_SEMILLA, por: "persona", procedencia: "estimado", fecha: "2026-10-01" } },
          { id: "propia-0001", franja_id: "tarde", nombre: "Casa Fassi", descripcion: "", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, propia: true, nota: NOTA_SEMILLA },
        ],
      },
    ],
  };
}

export async function sembrarPlan(servicio: SupabaseClient, planId: string, duenyoId: string, extra: { eliminado?: boolean } = {}): Promise<void> {
  await guardarPlan(servicio, planSemilla(planId));
  const { error } = await servicio.from("trabajos").insert({
    usuario_id: duenyoId,
    tipo: "generacion",
    criterios: { destino_o_tipo: "Sevilla", presupuesto_eur: PRESUPUESTO_SEMILLA },
    estado: "completado",
    plan_id: planId,
    ...(extra.eliminado ? { eliminado_en: new Date().toISOString() } : {}),
  });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

export async function invitar(servicio: SupabaseClient, planId: string, correo: string, invitadoPor: string): Promise<string> {
  const { data, error } = await servicio.from("miembros_plan").insert({ plan_id: planId, correo, invitado_por: invitadoPor }).select("id").single();
  if (error || !data) throw new Error(`No se pudo invitar: ${error?.message}`);
  return data.id as string;
}

export async function limpiarPlanes(servicio: SupabaseClient, planIds: string[]): Promise<void> {
  for (const id of planIds) {
    await servicio.from("trabajos").delete().eq("plan_id", id);
    await servicio.from("planes").delete().eq("id", id);
  }
}
