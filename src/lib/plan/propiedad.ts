import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INTERESES, type Interes } from "@/lib/criterios/intereses";
import type { OpcionesTramos } from "./tramos";

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
  // tramos-dia: con transporte = ['coche'] los tramos largos son en coche.
  transporte: string[] | null;
  // Para citar el interés en «por qué te lo proponemos».
  intereses: Interes[] | null;
}

function aTrabajoDelPlan(data: { id: string; estado: string; regenerado_en: string | null; criterios: unknown }): TrabajoDelPlan {
  const criterios = data.criterios as { perfil?: string; presupuesto_eur?: number; transporte?: unknown; intereses?: unknown } | null;
  return { id: data.id, estado: data.estado, regenerado_en: data.regenerado_en, perfil: criterios?.perfil ?? null,
    presupuesto_eur: typeof criterios?.presupuesto_eur === "number" ? criterios.presupuesto_eur : null,
    transporte: Array.isArray(criterios?.transporte) ? criterios.transporte.filter((m): m is string => typeof m === "string") : null,
    intereses: Array.isArray(criterios?.intereses) ? criterios.intereses.filter((i): i is Interes => (INTERESES as readonly unknown[]).includes(i)) : null,
  };
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
  return data ? aTrabajoDelPlan(data) : null;
}

// tiempos-unicos: la vista del plan y el .ics sacan perfil y transporte de aquí,
// para que las dos den los mismos minutos para el mismo viaje.
export function opcionesTramosDeTrabajo(trabajo: Pick<TrabajoDelPlan, "perfil" | "transporte">): OpcionesTramos {
  return { perfil: trabajo.perfil, transporte: trabajo.transporte };
}

export type RolPlan = { rol: "duenyo"; trabajo: TrabajoDelPlan } | { rol: "miembro"; trabajo: TrabajoDelPlan };

const MENSAJE_SOLO_DUENYO = "Solo quien creó el plan puede cambiarlo.";

// compartir-datos: dueño es quien tiene el trabajo no eliminado del plan; miembro,
// quien tiene una invitación por su correo mientras el trabajo del dueño siga
// vivo (eliminar el viaje le quita el acceso). Cualquier otro caso es null y la
// ruta responde 404, igual que para un plan que no existe.
export async function rolEnPlan(
  supabase: SupabaseClient,
  planId: string,
  sesion: { usuarioId: string; email: string },
): Promise<RolPlan | null> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, estado, regenerado_en, criterios, usuario_id")
    .eq("plan_id", planId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el trabajo del plan: ${error.message}`);
  if (!data) return null;
  const trabajo = aTrabajoDelPlan(data);
  if (data.usuario_id === sesion.usuarioId) return { rol: "duenyo", trabajo };

  const correo = sesion.email.trim().toLowerCase();
  if (!correo) return null;
  const { data: fila, error: errorMiembro } = await supabase
    .from("miembros_plan")
    .select("id")
    .eq("plan_id", planId)
    .eq("correo", correo)
    .maybeSingle();
  if (errorMiembro) throw new Error(`No se pudo comprobar la invitación al plan: ${errorMiembro.message}`);
  return fila ? { rol: "miembro", trabajo } : null;
}

// Guarda de toda ruta que escribe sobre un plan: devuelve el trabajo del dueño
// o la Response lista (403 al miembro, 404 a cualquier otro).
export async function exigirDuenyo(
  supabase: SupabaseClient,
  planId: string,
  sesion: { usuarioId: string; email: string },
): Promise<TrabajoDelPlan | Response> {
  const rol = await rolEnPlan(supabase, planId, sesion);
  if (!rol) return Response.json({ error: "no encontrado" }, { status: 404 });
  if (rol.rol === "miembro") return RESPUESTA_SOLO_DUENYO();
  return rol.trabajo;
}

// DELETE /api/viajes/[id] recibe el id del trabajo, no el del plan: para
// distinguir al miembro (403) del ajeno (404) hay que pasar por su plan.
export async function esMiembroDelTrabajo(
  supabase: SupabaseClient,
  trabajoId: string,
  sesion: { usuarioId: string; email: string },
): Promise<boolean> {
  const { data, error } = await supabase.from("trabajos").select("plan_id").eq("id", trabajoId).is("eliminado_en", null).maybeSingle();
  if (error) throw new Error(`No se pudo leer el trabajo: ${error.message}`);
  if (!data?.plan_id) return false;
  return (await rolEnPlan(supabase, data.plan_id as string, sesion))?.rol === "miembro";
}

export const RESPUESTA_SOLO_DUENYO = () => Response.json({ error: MENSAJE_SOLO_DUENYO }, { status: 403 });
