import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// planes no tiene su propia columna usuario_id: la propiedad se resuelve
// por el trabajo que lo generó, la única tabla con esa columna (mismo
// criterio que trabajos/consultar.ts: false, no un error, para no
// confirmar desde otro sitio que un identificador existe).
//
// borrar-ac1: un trabajo eliminado (marcado) deja de acreditar la propiedad
// de su plan, así que el plan pasa a responder 404 a su propio dueño -uno
// de los tres sitios que el borrado marcado obliga a filtrar, junto a
// listarViajes y obtenerTrabajo.
export async function planPerteneceAUsuario(
  supabase: SupabaseClient,
  planId: string,
  usuarioId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id")
    .eq("plan_id", planId)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo comprobar la propiedad del plan: ${error.message}`);
  return data !== null;
}

export interface TrabajoDelPlan {
  id: string;
  estado: string;
  regenerado_en: string | null;
  // enc-ac2: el umbral del "paseo estimado" depende del perfil de viaje,
  // que vive en los criterios del trabajo, nunca en el propio Plan -- un
  // trabajo sin perfil (no debería darse, es obligatorio en el esquema)
  // cae al umbral no familiar, el más permisivo.
  perfil: string | null;
  // mot-ac1: la cabecera compara las visitas con el presupuesto del usuario,
  // que vive en los criterios del trabajo, nunca en el Plan.
  presupuesto_eur: number | null;
}

// reg-ac4: el aviso "se está regenerando" en la vista del plan necesita el
// id del trabajo (para enlazar a /trabajos/<id>) y su estado, no solo si el
// plan es de este usuario -- misma consulta que planPerteneceAUsuario, con
// las columnas que regenerar.ts y el aviso necesitan además del booleano.
export async function trabajoDelPlan(
  supabase: SupabaseClient,
  planId: string,
  usuarioId: string,
): Promise<TrabajoDelPlan | null> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, estado, regenerado_en, criterios")
    .eq("plan_id", planId)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el trabajo del plan: ${error.message}`);
  if (!data) return null;
  const criterios = data.criterios as { perfil?: string; presupuesto_eur?: number } | null;
  return { id: data.id, estado: data.estado, regenerado_en: data.regenerado_en, perfil: criterios?.perfil ?? null,
    presupuesto_eur: typeof criterios?.presupuesto_eur === "number" ? criterios.presupuesto_eur : null,
  };
}
