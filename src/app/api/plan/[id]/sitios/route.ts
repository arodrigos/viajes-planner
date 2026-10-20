import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { exigirDuenyo } from "@/lib/plan/propiedad";
import { errorDeFuncionSitio, MENSAJES_SITIO, validarSitio } from "@/lib/plan/sitiosPropios";

// Alta de un sitio propio en un día. Crea una versión nueva del plan en una
// sola transacción (anadir_sitio_propio, que solo ejecuta service_role), así
// que la propiedad se comprueba aquí: un plan ajeno, inexistente o eliminado
// da el mismo 404 que el resto de /api/plan/[id].
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/sitios">) {
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
    return NextResponse.json({ error: MENSAJES_SITIO.nombre }, { status: 400 });
  }
  const { dia, nombre, nota, version_base: versionBase } = (typeof cuerpo === "object" && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>;
  const sitio = validarSitio(nombre, nota, true);
  if ("error" in sitio) return NextResponse.json({ error: sitio.error }, { status: 400 });
  if (!Number.isInteger(dia) || (dia as number) < 0) return NextResponse.json({ error: MENSAJES_SITIO.dia }, { status: 400 });
  if (!Number.isInteger(versionBase) || (versionBase as number) < 1) return NextResponse.json({ error: MENSAJES_SITIO.version }, { status: 400 });

  try {
    const { data, error } = await supabase.rpc("anadir_sitio_propio", {
      p_plan_id: id,
      p_version_base: versionBase,
      p_dia_index: dia,
      p_nombre: sitio.nombre,
      p_nota: sitio.nota,
    });
    if (error) {
      const previsto = errorDeFuncionSitio(error.message);
      if (previsto) return NextResponse.json({ error: previsto.error }, { status: previsto.status });
      throw new Error(error.message);
    }
    const fila = (data as { version: number; id_externo: string }[] | null)?.[0];
    if (!fila) throw new Error("la función no devolvió la versión nueva");
    return NextResponse.json({ version: fila.version, id_externo: fila.id_externo }, { status: 201 });
  } catch (fallo) {
    // Solo el texto del error, sin filas del plan, como el resto de rutas del plan.
    const detalle = (fallo instanceof Error ? fallo.message : "error desconocido").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 300);
    console.error("POST /api/plan/[id]/sitios:", detalle);
    return NextResponse.json({ error: MENSAJES_SITIO.interno }, { status: 500 });
  }
}
