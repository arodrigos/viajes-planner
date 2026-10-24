import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { exigirDuenyo } from "@/lib/plan/propiedad";
import { MAX_CAMBIOS_POR_HORA } from "@/app/api/plan/[id]/orden/route";
import { TEXTOS_ARREGLOS } from "@/lib/textos/arreglos";

const MENSAJES = {
  invalido: "No se puede llevar la parada a ese día.",
  desfasada: TEXTOS_ARREGLOS.desfasada.texto,
  demasiados: TEXTOS_ARREGLOS.demasiados.texto,
  interno: TEXTOS_ARREGLOS.errorRed.texto,
} as const;

function respuesta(status: number, error: string, mensaje: string) {
  return NextResponse.json({ error, mensaje }, { status });
}

interface Peticion {
  version_base: number;
  dia_origen: number;
  dia_destino: number;
  franja_id: string;
  posicion?: number;
  deshacer: boolean;
}

function leerPeticion(cuerpo: unknown): Peticion | null {
  if (typeof cuerpo !== "object" || cuerpo === null) return null;
  const { version_base, dia_origen, dia_destino, franja_id, posicion, deshacer } = cuerpo as Record<string, unknown>;
  if (deshacer !== undefined && typeof deshacer !== "boolean") return null;
  if (!Number.isInteger(version_base) || (version_base as number) < 1) return null;
  if (!Number.isInteger(dia_origen) || (dia_origen as number) < 0) return null;
  if (!Number.isInteger(dia_destino) || (dia_destino as number) < 0) return null;
  if (typeof franja_id !== "string" || franja_id.length === 0 || franja_id.length > 50) return null;
  if (posicion !== undefined && (!Number.isInteger(posicion) || (posicion as number) < 0 || (posicion as number) > 1000)) return null;
  return { version_base: version_base as number, dia_origen: dia_origen as number, dia_destino: dia_destino as number, franja_id, deshacer: deshacer === true, ...(posicion !== undefined ? { posicion: posicion as number } : {}) };
}

// arr-ac1: mismo 404 uniforme que el resto de /api/plan/[id] para un plan
// ajeno. La función SQL solo la ejecuta service_role, así que la propiedad se
// comprueba aquí.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/paradas/[paradaId]/mover-dia">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id, paradaId } = await ctx.params;
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
  if (!peticion || paradaId.length === 0 || paradaId.length > 200) return respuesta(400, "orden-invalido", MENSAJES.invalido);

  try {
    // Cada arreglo es una versión entera, como un cambio de orden: mismo tope por hora.
    // El Deshacer de un arreglo tiene una versión reservada por encima del tope:
    // si no, el arreglo n.º 30 se aplicaría sin que se pudiera revertir (arr-ac3).
    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: errorConteo } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", id).gte("creado_en", desde);
    if (errorConteo) throw new Error(errorConteo.message);
    if ((count ?? 0) >= MAX_CAMBIOS_POR_HORA + (peticion.deshacer ? 1 : 0)) return respuesta(429, "demasiados-cambios", MENSAJES.demasiados);

    const { data, error } = await supabase.rpc("mover_parada_a_dia", {
      p_plan_id: id,
      p_version_base: peticion.version_base,
      p_dia_origen: peticion.dia_origen,
      p_parada_id: paradaId,
      p_dia_destino: peticion.dia_destino,
      p_franja_id: peticion.franja_id,
      ...(peticion.posicion !== undefined ? { p_posicion: peticion.posicion } : {}),
    });
    if (error) {
      // 23505: un clon del trabajador se llevó la versión N+1 entre la lectura y el insert.
      if (error.code === "23505" || error.message.includes("version-desfasada")) return respuesta(409, "version-desfasada", MENSAJES.desfasada);
      if (error.message.includes("orden-invalido")) return respuesta(400, "orden-invalido", MENSAJES.invalido);
      throw new Error(error.message);
    }
    const fila = (Array.isArray(data) ? data[0] : data) as { version: number } | null;
    if (!fila) throw new Error("la función no devolvió versión");
    return NextResponse.json({ version: fila.version });
  } catch (fallo) {
    const detalle = (fallo instanceof Error ? fallo.message : "error desconocido").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 300);
    console.error("POST /api/plan/[id]/paradas/[paradaId]/mover-dia:", detalle);
    return respuesta(500, "interno", MENSAJES.interno);
  }
}
