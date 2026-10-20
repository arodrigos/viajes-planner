import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { quitarMiembro } from "@/lib/plan/miembros";
import { exigirDuenyo } from "@/lib/plan/propiedad";

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/miembros/[miembroId]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id, miembroId } = await ctx.params;
  const supabase = clienteServicio();
  const guarda = await exigirDuenyo(supabase, id, sesion);
  if (guarda instanceof Response) return guarda;

  if (!(await quitarMiembro(supabase, id, miembroId))) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
