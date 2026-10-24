import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { borrarReservasDelPlan } from "@/lib/reservas/repositorio";

// borrar-ac2/borrar-ac3: MARCA, nunca borra -la fila, su plan, sus versiones
// y sus paradas siguen existiendo, así que se puede deshacer a mano
// poniendo esta columna a null. El filtro `usuario_id` es la defensa real
// (mismo patrón que listarViajes/obtenerTrabajo: la clave de servicio
// atraviesa RLS, así que el control vive aquí). `is("eliminado_en", null)`
// hace la operación idempotente: una segunda llamada no encuentra fila que
// marcar y devuelve el mismo `false` que un trabajo ajeno, sin distinguir
// los dos casos -que es justo lo que impide confirmar a nadie que un
// identificador existe si no es (ya) suyo.
//
// res-ac6: lo único que SÍ se borra de verdad son las reservas del viaje (datos
// personales nuevos: localizador, horas, hotel). Un ON DELETE CASCADE hacia
// planes nunca salta con el borrado marcado, así que se borran aquí, ANTES de
// marcar: si el borrado falla, el viaje sigue vivo y se puede reintentar.
export async function eliminarViaje(supabase: SupabaseClient, trabajoId: string, usuarioId: string): Promise<boolean> {
  const { data: trabajo, error: errorLectura } = await supabase
    .from("trabajos")
    .select("plan_id")
    .eq("id", trabajoId)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (errorLectura) throw new Error(`No se pudo eliminar el viaje: ${errorLectura.message}`);
  if (!trabajo) return false;
  if (trabajo.plan_id) await borrarReservasDelPlan(supabase, trabajo.plan_id as string);
  const { data, error } = await supabase
    .from("trabajos")
    .update({ eliminado_en: new Date().toISOString() })
    .eq("id", trabajoId)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`No se pudo eliminar el viaje: ${error.message}`);
  return data !== null;
}
