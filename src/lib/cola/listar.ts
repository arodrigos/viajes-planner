import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriteriosViaje, Fechas } from "../criterios/tipos";

export interface ViajeListado {
  id: string;
  destino: string;
  fecha: string;
  // Primer día del viaje (AAAA-MM-DD); null si solo se indicó una época.
  fecha_inicio: string | null;
  // Último día del viaje (AAAA-MM-DD); null si solo se indicó una época.
  fecha_fin: string | null;
  estado: string;
  plan_id: string | null;
  // compartir-datos: true en los viajes de otra persona que te ha invitado.
  compartido: boolean;
}

function textoFecha(fechas: Fechas | undefined): string {
  if (!fechas) return "sin fecha indicada";
  return fechas.modo === "fechas" ? `${fechas.inicio} – ${fechas.fin}` : fechas.epoca;
}

function fechaInicio(fechas: Fechas | undefined): string | null {
  return fechas?.modo === "fechas" ? fechas.inicio : null;
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
export async function listarViajes(supabase: SupabaseClient, usuarioId: string, correo = ""): Promise<ViajeListado[]> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, criterios, estado, plan_id")
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudo listar los viajes: ${error.message}`);

  const propios = (data ?? []).map((fila) => aViaje(fila, false));
  return [...propios, ...(await listarCompartidos(supabase, correo))];
}

type FilaTrabajo = { id: string; criterios: unknown; estado: string; plan_id: string | null };

function aViaje(fila: FilaTrabajo, compartido: boolean): ViajeListado {
  const criterios = fila.criterios as CriteriosViaje | null;
  return {
    id: fila.id,
    destino: criterios?.destino_o_tipo ?? "Destino sin especificar",
    fecha: textoFecha(criterios?.fechas),
    fecha_inicio: fechaInicio(criterios?.fechas),
    fecha_fin: fechaFin(criterios?.fechas),
    estado: fila.estado,
    plan_id: fila.plan_id,
    compartido,
  };
}

// Los planes a los que el correo está invitado y cuyo dueño no los ha eliminado:
// el filtro por eliminado_en es lo que hace desaparecer el viaje compartido
// cuando el dueño lo borra.
async function listarCompartidos(supabase: SupabaseClient, correo: string): Promise<ViajeListado[]> {
  const normalizado = correo.trim().toLowerCase();
  if (!normalizado) return [];
  const { data: invitaciones, error: errorInvitaciones } = await supabase.from("miembros_plan").select("plan_id").eq("correo", normalizado);
  if (errorInvitaciones) throw new Error(`No se pudo leer los viajes compartidos: ${errorInvitaciones.message}`);
  const planes = (invitaciones ?? []).map((i) => i.plan_id as string);
  if (planes.length === 0) return [];
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, criterios, estado, plan_id")
    .in("plan_id", planes)
    .is("eliminado_en", null)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(`No se pudo leer los viajes compartidos: ${error.message}`);
  return (data ?? []).map((fila) => aViaje(fila, true));
}
