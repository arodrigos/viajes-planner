import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoMarca, MarcaEntrada } from "./validar";

export interface Marca {
  elemento: string;
  estado: EstadoMarca;
  actualizado_cliente: string;
}

export async function listarMarcas(supabase: SupabaseClient, planId: string): Promise<Marca[]> {
  const { data, error } = await supabase.from("preparativos_marcas").select("elemento, estado, actualizado_cliente").eq("plan_id", planId).order("elemento");
  if (error) throw new Error(`No se pudieron leer las marcas: ${error.message}`);
  return ((data ?? []) as Marca[]).map((m) => ({ ...m, actualizado_cliente: new Date(m.actualizado_cliente).toISOString() }));
}

export async function guardarMarca(supabase: SupabaseClient, planId: string, elemento: string, marca: MarcaEntrada): Promise<void> {
  const { error } = await supabase.rpc("guardar_marca_preparativo", {
    p_plan_id: planId,
    p_elemento: elemento,
    p_estado: marca.estado,
    p_actualizado: marca.actualizado_cliente,
  });
  if (error) throw new Error(`No se pudo guardar la marca: ${error.message}`);
}

export async function borrarMarcasDelPlan(supabase: SupabaseClient, planId: string): Promise<void> {
  const { error } = await supabase.from("preparativos_marcas").delete().eq("plan_id", planId);
  if (error) throw new Error(`No se pudieron borrar las marcas del viaje: ${error.message}`);
}
