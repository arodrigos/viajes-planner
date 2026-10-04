import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { regenerarViaje } from "@/lib/cola/regenerar";
import { clienteServicio } from "@/lib/db/cliente";

const MENSAJE_EN_CURSO = "Este viaje ya se está regenerando; espera a que termine";
const MENSAJE_DEMASIADO_PRONTO = "Solo se puede regenerar un viaje una vez por hora";

// reg-ac3: plan ajeno o trabajo eliminado (marcado) -> 404 (nunca 403,
// mismo criterio que GET /api/plan/[id] y que sustituir); sin cuerpo que
// leer, sin invocar al modelo ni a ninguna fuente externa.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/regenerar">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const resultado = await regenerarViaje(supabase, id, sesion.usuarioId);

  if (resultado.estado === "no-encontrado") return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  if (resultado.estado === "en-curso") return NextResponse.json({ error: MENSAJE_EN_CURSO }, { status: 409 });
  if (resultado.estado === "demasiado-pronto") return NextResponse.json({ error: MENSAJE_DEMASIADO_PRONTO }, { status: 429 });

  return NextResponse.json({ trabajo_id: resultado.trabajoId });
}
