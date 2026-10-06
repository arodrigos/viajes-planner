import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// borrar-ac2/borrar-ac3: MARCA, nunca borra -la fila, su plan, sus versiones
// y sus paradas siguen existiendo, así que se puede deshacer a mano
// poniendo esta columna a null. El filtro `usuario_id` es la defensa real
// (mismo patrón que listarViajes/obtenerTrabajo: la clave de servicio
// atraviesa RLS, así que el control vive aquí). `is("eliminado_en", null)`
// hace la operación idempotente: una segunda llamada no encuentra fila que
// marcar y devuelve el mismo `false` que un trabajo ajeno, sin distinguir
// los dos casos -que es justo lo que impide confirmar a nadie que un
// identificador existe si no es (ya) suyo.
export async function eliminarViaje(supabase: SupabaseClient, trabajoId: string, usuarioId: string): Promise<boolean> {
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
