import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { aPlanPublico } from "@/lib/plan/publico";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";

// El plan de otro usuario responde 404, no 403 (mismo criterio que
// /api/trabajos/[id]): no hay que confirmarle a nadie que un identificador
// existe si no es suyo.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const esPropio = await planPerteneceAUsuario(supabase, id, sesion.usuarioId);
  if (!esPropio) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const plan = await recuperarPlan(supabase, id);
  if (!plan) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  return NextResponse.json(aPlanPublico(plan));
}
