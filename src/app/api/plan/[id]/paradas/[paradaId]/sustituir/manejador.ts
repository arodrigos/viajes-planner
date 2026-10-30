import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { exigirDuenyo } from "@/lib/plan/propiedad";
import { sustituirParada } from "@/lib/plan/sustituir";
import { leerCuerpoJson } from "@/lib/api/cuerpo";

// alt-ac6: mismo criterio que GET /api/plan/[id] -- un plan ajeno responde
// 404, nunca 403; este endpoint no invoca al modelo ni a ninguna fuente
// externa, solo lee y reescribe el plan guardado.
export async function POST(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/paradas/[paradaId]/sustituir">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id, paradaId } = await ctx.params;
  const supabase = clienteServicio();

  const guarda = await exigirDuenyo(supabase, id, sesion);
  if (guarda instanceof Response) return guarda;

  const leido = await leerCuerpoJson(request);
  if ("respuesta" in leido) return leido.respuesta;
  const cuerpo = leido.cuerpo;
  const alternativaId = (cuerpo as { alternativa_id?: unknown })?.alternativa_id;
  if (typeof alternativaId !== "string" || alternativaId.length === 0) {
    return NextResponse.json({ error: "falta 'alternativa_id'" }, { status: 400 });
  }

  const resultado = await sustituirParada(supabase, id, paradaId, alternativaId);

  if (resultado.estado === "no-encontrado") {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }
  if (resultado.estado === "alternativa-invalida") {
    return NextResponse.json({ error: "esa alternativa no es de este plan o el plan ha cambiado; recarga" }, { status: 400 });
  }
  return NextResponse.json({ version: resultado.version });
}
