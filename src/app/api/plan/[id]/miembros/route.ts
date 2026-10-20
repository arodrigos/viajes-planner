import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { invitarMiembro, listarMiembros, MENSAJES_MIEMBROS } from "@/lib/plan/miembros";
import { exigirDuenyo } from "@/lib/plan/propiedad";

// Solo el dueño ve y cambia con quién se comparte su plan: el miembro recibe
// 403 y un ajeno el 404 de siempre.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/miembros">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();
  const guarda = await exigirDuenyo(supabase, id, sesion);
  if (guarda instanceof Response) return guarda;

  return NextResponse.json({ miembros: await listarMiembros(supabase, id) });
}

const ESTADO_HTTP = { invalido: 400, "no-permitido": 422, propio: 422, lleno: 422 } as const;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/miembros">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();
  const guarda = await exigirDuenyo(supabase, id, sesion);
  if (guarda instanceof Response) return guarda;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: MENSAJES_MIEMBROS.correo }, { status: 400 });
  }
  const correo = typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as { correo?: unknown }).correo : undefined;

  const resultado = await invitarMiembro(supabase, id, sesion, correo);
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: ESTADO_HTTP[resultado.estado] });
  return NextResponse.json(resultado.miembro, { status: resultado.estado === "creado" ? 201 : 200 });
}
