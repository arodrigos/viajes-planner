import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanPublico } from "@/lib/plan/publico";
import type { Plan } from "@/lib/plan/tipos";

// Lo único que el navegador sabe de Google por parada. El place_id no sale
// nunca por aquí: solo por la ruta de la ficha, que reserva cupo.
export type EstadoGoogleParada = "sin-ubicacion" | "pendiente" | "sin-coincidencia" | "casado";

export function estadoDeFila(tieneLugar: boolean, estadoFila: string | undefined): EstadoGoogleParada {
  if (!tieneLugar) return "sin-ubicacion";
  if (estadoFila === "casado" || estadoFila === "sin-coincidencia") return estadoFila;
  // Sin fila, obsoleto o error: el trabajador lo volverá a intentar.
  return "pendiente";
}

export async function leerEstadosGoogle(supabase: SupabaseClient, plan: Plan): Promise<Map<string, EstadoGoogleParada>> {
  const claves = new Set<string>();
  for (const dia of plan.dias) for (const parada of dia.paradas) if (parada.lugar) claves.add(parada.lugar.id);

  const estadoPorClave = new Map<string, string>();
  if (claves.size > 0) {
    const { data, error } = await supabase.from("lugares_google").select("clave, estado").in("clave", [...claves]);
    if (error) throw new Error(error.message);
    for (const fila of (data as Array<{ clave: string; estado: string }> | null) ?? []) estadoPorClave.set(fila.clave, fila.estado);
  }

  const estados = new Map<string, EstadoGoogleParada>();
  for (const dia of plan.dias) {
    for (const parada of dia.paradas) {
      estados.set(parada.id, estadoDeFila(Boolean(parada.lugar), parada.lugar ? estadoPorClave.get(parada.lugar.id) : undefined));
    }
  }
  return estados;
}

export function conEstadoGoogle(plan: PlanPublico, estados: ReadonlyMap<string, EstadoGoogleParada>): PlanPublico {
  return {
    ...plan,
    dias: plan.dias.map((dia) => ({
      ...dia,
      paradas: dia.paradas.map((parada) => {
        const estado = estados.get(parada.id);
        return estado ? { ...parada, google: { estado } } : parada;
      }),
    })),
  };
}
