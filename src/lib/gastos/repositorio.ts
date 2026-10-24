import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gasto, GastoEntrada } from "./tipos";

interface Fila {
  id: string;
  importe_centimos: number;
  fecha: string | null;
  categoria: Gasto["categoria"];
  concepto: string | null;
  actualizado_cliente: string;
}

const COLUMNAS = "id, importe_centimos, fecha, categoria, concepto, actualizado_cliente";

export function deFila(f: Fila): Gasto {
  return {
    id: f.id,
    importe_centimos: f.importe_centimos,
    fecha: f.fecha,
    categoria: f.categoria,
    ...(f.concepto ? { concepto: f.concepto } : {}),
    actualizado_cliente: new Date(f.actualizado_cliente).toISOString(),
  };
}

export async function listarGastos(supabase: SupabaseClient, planId: string): Promise<Gasto[]> {
  const { data, error } = await supabase.from("gastos").select(COLUMNAS).eq("plan_id", planId).order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los gastos: ${error.message}`);
  return ((data ?? []) as Fila[]).map(deFila);
}

export async function contarGastos(supabase: SupabaseClient, planId: string): Promise<number> {
  const { count, error } = await supabase.from("gastos").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron contar los gastos: ${error.message}`);
  return count ?? 0;
}

// El tope solo frena altas: reenviar o editar un gasto que ya está no lo cuenta.
export async function existeGastoEnPlan(supabase: SupabaseClient, planId: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.from("gastos").select("id").eq("id", id).eq("plan_id", planId).maybeSingle();
  if (error) throw new Error(`No se pudo comprobar el gasto: ${error.message}`);
  return data !== null;
}

export class GastoDeOtroPlan extends Error {}

export async function guardarGasto(supabase: SupabaseClient, planId: string, id: string, gasto: GastoEntrada): Promise<void> {
  const { error } = await supabase.rpc("guardar_gasto", {
    p_plan_id: planId,
    p_id: id,
    p_importe: gasto.importe_centimos,
    p_fecha: gasto.fecha,
    p_categoria: gasto.categoria,
    p_concepto: gasto.concepto ?? null,
    p_actualizado: gasto.actualizado_cliente,
  });
  if (error) {
    if (error.message.includes("gasto-de-otro-plan")) throw new GastoDeOtroPlan();
    throw new Error(`No se pudo guardar el gasto: ${error.message}`);
  }
}

// Idempotente: borrar lo que no existe no es un error.
export async function borrarGasto(supabase: SupabaseClient, planId: string, id: string): Promise<void> {
  const { error } = await supabase.from("gastos").delete().eq("id", id).eq("plan_id", planId);
  if (error) throw new Error(`No se pudo borrar el gasto: ${error.message}`);
}

export async function borrarGastosDelPlan(supabase: SupabaseClient, planId: string): Promise<void> {
  const { error } = await supabase.from("gastos").delete().eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron borrar los gastos del viaje: ${error.message}`);
}
