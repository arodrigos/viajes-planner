import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { eliminarViaje } from "@/lib/cola/eliminar";

// borrar-ac3: el trabajo de otro usuario responde 404, no 403 (mismo
// criterio que /api/plan/[id] y /api/trabajos/[id]): no hay que confirmarle
// a nadie que un identificador existe si no es suyo, y no marca nada.
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/viajes/[id]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const eliminado = await eliminarViaje(supabase, id, sesion.usuarioId);
  if (!eliminado) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
