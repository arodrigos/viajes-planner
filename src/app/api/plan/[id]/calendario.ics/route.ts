import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { generarIcsPlan } from "@/lib/plan/calendario";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";

// ics-ac1: misma guarda que GET /api/plan/[id] -- un plan ajeno responde
// 404, nunca 403.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/calendario.ics">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const esPropio = await planPerteneceAUsuario(supabase, id, sesion.usuarioId);
  if (!esPropio) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const plan = await recuperarPlan(supabase, id);
  if (!plan) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const { contenido, nombreFichero } = generarIcsPlan(plan);
  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreFichero}"`,
    },
  });
}
