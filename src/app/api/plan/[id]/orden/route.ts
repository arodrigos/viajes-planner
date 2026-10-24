import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { conEstadoGoogle, leerEstadosGoogle } from "@/lib/google/estados";
import { aPlanPublico } from "@/lib/plan/publico";
import { reservasOpcionales } from "@/lib/reservas/repositorio";
import { exigirDuenyo, opcionesTramosDeTrabajo } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";
import { validarOrden, type EntradaOrden, type PeticionOrden } from "@/lib/plan/reordenar";

// Cada cambio de orden es una versión entera (paradas y alternativas
// copiadas): el tope evita que un script llene la base con copias.
export const MAX_CAMBIOS_POR_HORA = 30;
const MAX_PARADAS_POR_DIA = 100;

const MENSAJES = {
  invalido: "El nuevo orden no es válido para este día.",
  desfasada: "El plan se acaba de actualizar mientras guardabas. Hemos cargado la versión más reciente; vuelve a ordenar si lo necesitas.",
  demasiados: "Has cambiado el orden muchas veces en poco tiempo. Espera unos minutos y vuelve a intentarlo.",
  interno: "No se ha podido guardar el nuevo orden.",
} as const;

function respuesta(status: number, error: string, mensaje: string) {
  return NextResponse.json({ error, mensaje }, { status });
}

function leerPeticion(cuerpo: unknown): PeticionOrden | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const { version_base, dia_index, orden } = cuerpo as Record<string, unknown>;
  if (!Number.isInteger(version_base) || (version_base as number) < 1) return null;
  if (!Number.isInteger(dia_index) || (dia_index as number) < 0) return null;
  if (!Array.isArray(orden) || orden.length === 0 || orden.length > MAX_PARADAS_POR_DIA) return null;
  const entradas: EntradaOrden[] = [];
  for (const e of orden) {
    const { id, franja_id } = (e ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || typeof franja_id !== "string" || id.length === 0 || id.length > 200 || franja_id.length > 50) return null;
    entradas.push({ id, franja_id });
  }
  return { version_base: version_base as number, dia_index: dia_index as number, orden: entradas };
}

// Mismo 404 uniforme que el resto de /api/plan/[id] para un plan ajeno,
// inexistente o con el trabajo eliminado. La RPC solo la ejecuta service_role,
// así que la propiedad se comprueba aquí y no en la base.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/orden">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const trabajo = await exigirDuenyo(supabase, id, sesion);
  if (trabajo instanceof Response) return trabajo;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return respuesta(400, "orden-invalido", MENSAJES.invalido);
  }
  const peticion = leerPeticion(cuerpo);
  if (!peticion) return respuesta(400, "orden-invalido", MENSAJES.invalido);

  try {
    const { data: ultimas, error: errorVersion } = await supabase
      .from("plan_versiones")
      .select("id, version, dias")
      .eq("plan_id", id)
      .order("version", { ascending: false })
      .limit(1);
    if (errorVersion) throw new Error(errorVersion.message);
    const ultima = ultimas?.[0] as { id: string; version: number; dias: { franjas: { id: string }[] }[] } | undefined;
    if (!ultima) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    if (ultima.version !== peticion.version_base) return respuesta(409, "version-desfasada", MENSAJES.desfasada);

    const franjas = ultima.dias[peticion.dia_index]?.franjas;
    if (!franjas) return respuesta(400, "orden-invalido", MENSAJES.invalido);
    const { data: filas, error: errorParadas } = await supabase
      .from("paradas")
      .select("id_externo, franja_id")
      .eq("plan_version_id", ultima.id)
      .eq("dia_index", peticion.dia_index);
    if (errorParadas) throw new Error(errorParadas.message);
    const base = (filas ?? []).map((f) => ({ id: f.id_externo as string, franja_id: f.franja_id as string }));
    if (!validarOrden(base, peticion.orden, franjas).ok) return respuesta(400, "orden-invalido", MENSAJES.invalido);

    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: errorConteo } = await supabase
      .from("plan_versiones")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", id)
      .gte("creado_en", desde);
    if (errorConteo) throw new Error(errorConteo.message);
    if ((count ?? 0) >= MAX_CAMBIOS_POR_HORA) return respuesta(429, "demasiados-cambios", MENSAJES.demasiados);

    const { error: errorRpc } = await supabase.rpc("reordenar_dia_plan", {
      p_plan_id: id,
      p_version_base: peticion.version_base,
      p_dia_index: peticion.dia_index,
      p_orden: peticion.orden,
    });
    if (errorRpc) {
      // 23505: un clon del trabajador (que no bloquea el plan) se llevó la versión N+1.
      if (errorRpc.code === "23505" || errorRpc.message.includes("version-desfasada")) return respuesta(409, "version-desfasada", MENSAJES.desfasada);
      if (errorRpc.message.includes("orden-invalido")) return respuesta(400, "orden-invalido", MENSAJES.invalido);
      throw new Error(errorRpc.message);
    }

    const plan = await recuperarPlan(supabase, id);
    if (!plan) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
    const opciones = opcionesTramosDeTrabajo(trabajo);
    const publico = aPlanPublico(plan, opciones.perfil, trabajo.presupuesto_eur, opciones.transporte, trabajo.intereses, await reservasOpcionales(supabase, id));
    const conGoogle = await leerEstadosGoogle(supabase, plan).then(
      (estados) => conEstadoGoogle(publico, estados),
      () => publico,
    );
    const regenerando = trabajo.regenerado_en !== null && ["encolado", "en-curso", "pausado-por-cuota"].includes(trabajo.estado);
    return NextResponse.json({ plan: { ...conGoogle, regenerando, trabajoId: trabajo.id } });
  } catch (fallo) {
    // Solo el texto del error, sin filas del plan, como GET /api/plan/[id].
    const detalle = (fallo instanceof Error ? fallo.message : "error desconocido").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 300);
    console.error("POST /api/plan/[id]/orden:", detalle);
    return respuesta(500, "interno", MENSAJES.interno);
  }
}
