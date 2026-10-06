import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriteriosViaje, Fechas } from "../criterios/tipos";

export interface ViajeListado {
  id: string;
  destino: string;
  fecha: string;
  // Último día del viaje (AAAA-MM-DD); null si solo se indicó una época.
  fecha_fin: string | null;
  estado: string;
  plan_id: string | null;
}

function textoFecha(fechas: Fechas | undefined): string {
  if (!fechas) return "sin fecha indicada";
  return fechas.modo === "fechas" ? `${fechas.inicio} – ${fechas.fin}` : fechas.epoca;
}

function fechaFin(fechas: Fechas | undefined): string | null {
  return fechas?.modo === "fechas" ? fechas.fin : null;
}

// viajes-ac1: el filtro por usuario_id aquí, con la clave de servicio, es la
// defensa real -la política RLS de la migración 7 es una segunda capa que
// esta misma llamada no atraviesa (ver rls.integration.test.ts).
//
// borrar-ac1: un viaje eliminado (marcado, no borrado) deja de listarse aquí
// -uno de los tres sitios que el borrado marcado obliga a filtrar, junto a
// planPerteneceAUsuario y obtenerTrabajo.
export async function listarViajes(supabase: SupabaseClient, usuarioId: string): Promise<ViajeListado[]> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, criterios, estado, plan_id")
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudo listar los viajes: ${error.message}`);

  return (data ?? []).map((fila) => {
    const criterios = fila.criterios as CriteriosViaje | null;
    return {
      id: fila.id,
      destino: criterios?.destino_o_tipo ?? "Destino sin especificar",
      fecha: textoFecha(criterios?.fechas),
      fecha_fin: fechaFin(criterios?.fechas),
      estado: fila.estado,
      plan_id: fila.plan_id,
    };
  });
}
