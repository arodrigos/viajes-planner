import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";
import { desmarcarVisitada, marcarVisitada } from "@/lib/plan/visitas";

function leerParadaId(cuerpo: unknown): string | null {
  const valor = (cuerpo as { parada_id?: unknown })?.parada_id;
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

async function leerCuerpoYParadaId(request: NextRequest): Promise<{ paradaId: string } | NextResponse> {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo de la petición no es JSON válido" }, { status: 400 });
  }
  const paradaId = leerParadaId(cuerpo);
  if (!paradaId) return NextResponse.json({ error: "falta 'parada_id'" }, { status: 400 });
  return { paradaId };
}

// dest-ac1: mismo criterio que sustituir/route.ts -- un plan ajeno responde
// 404, nunca 403.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/visitas">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const esPropio = await planPerteneceAUsuario(supabase, id, sesion.usuarioId);
  if (!esPropio) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const cuerpo = await leerCuerpoYParadaId(request);
  if (cuerpo instanceof NextResponse) return cuerpo;

  const resultado = await marcarVisitada(supabase, id, cuerpo.paradaId);
  if (resultado === "no-encontrada") return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/visitas">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const esPropio = await planPerteneceAUsuario(supabase, id, sesion.usuarioId);
  if (!esPropio) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const cuerpo = await leerCuerpoYParadaId(request);
  if (cuerpo instanceof NextResponse) return cuerpo;

  const resultado = await desmarcarVisitada(supabase, id, cuerpo.paradaId);
  if (resultado === "no-encontrada") return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
