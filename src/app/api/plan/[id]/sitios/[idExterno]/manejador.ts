import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { exigirDuenyo } from "@/lib/plan/propiedad";
import { errorDeFuncionSitio, MENSAJES_SITIO, validarSitio } from "@/lib/plan/sitiosPropios";

type Contexto = ContextoRuta<"/api/plan/[id]/sitios/[idExterno]">;

function versionBaseValida(valor: unknown): number | null {
  return Number.isInteger(valor) && (valor as number) >= 1 ? (valor as number) : null;
}

async function ejecutar(
  request: NextRequest,
  ctx: Contexto,
  metodo: "PATCH" | "DELETE",
  preparar: (planId: string, idExterno: string) => Promise<{ funcion: string; argumentos: Record<string, unknown> } | NextResponse>,
) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id, idExterno } = await ctx.params;
  const supabase = clienteServicio();
  const trabajo = await exigirDuenyo(supabase, id, sesion);
  if (trabajo instanceof Response) return trabajo;

  const llamada = await preparar(id, idExterno);
  if (llamada instanceof NextResponse) return llamada;

  try {
    const { data, error } = await supabase.rpc(llamada.funcion, llamada.argumentos);
    if (error) {
      const previsto = errorDeFuncionSitio(error);
      if (previsto) return NextResponse.json({ error: previsto.error }, { status: previsto.status });
      throw new Error(error.message);
    }
    const fila = (data as { version: number }[] | null)?.[0];
    if (!fila) throw new Error("la función no devolvió la versión nueva");
    return NextResponse.json({ version: fila.version });
  } catch (fallo) {
    const detalle = (fallo instanceof Error ? fallo.message : "error desconocido").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 300);
    console.error(`${metodo} /api/plan/[id]/sitios/[idExterno]:`, detalle);
    return NextResponse.json({ error: MENSAJES_SITIO.interno }, { status: 500 });
  }
}

// Corregir el nombre de un sitio propio (p. ej. tras «no encontrado»): versión
// nueva con el sitio otra vez en «buscando».
export async function PATCH(request: NextRequest, ctx: Contexto) {
  return ejecutar(request, ctx, "PATCH", async (planId, idExterno) => {
    let cuerpo: unknown;
    try {
      cuerpo = await request.json();
    } catch {
      return NextResponse.json({ error: MENSAJES_SITIO.nombre }, { status: 400 });
    }
    const { nombre, version_base: versionBase } = (typeof cuerpo === "object" && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>;
    const sitio = validarSitio(nombre, undefined, false);
    if ("error" in sitio) return NextResponse.json({ error: sitio.error }, { status: 400 });
    const base = versionBaseValida(versionBase);
    if (base === null) return NextResponse.json({ error: MENSAJES_SITIO.version }, { status: 400 });
    return { funcion: "corregir_sitio_propio", argumentos: { p_plan_id: planId, p_version_base: base, p_id_externo: idExterno, p_nombre: sitio.nombre } };
  });
}

export async function DELETE(request: NextRequest, ctx: Contexto) {
  return ejecutar(request, ctx, "DELETE", async (planId, idExterno) => {
    const base = versionBaseValida(Number(request.nextUrl.searchParams.get("version_base")));
    if (base === null) return NextResponse.json({ error: MENSAJES_SITIO.version }, { status: 400 });
    return { funcion: "quitar_sitio_propio", argumentos: { p_plan_id: planId, p_version_base: base, p_id_externo: idExterno } };
  });
}
