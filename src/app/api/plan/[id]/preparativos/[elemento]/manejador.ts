import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { guardarMarca } from "@/lib/preparativos/repositorio";
import { validarMarca } from "@/lib/preparativos/validar";
import { comoDuenyo, respuestaFallo } from "@/lib/reservas/ruta";
import { ERRORES_PREPARATIVOS as E } from "@/lib/textos/preparativos";

// Upsert idempotente con last-write-wins: repetir el PUT (reintento tras un
// corte) no cambia nada y uno más viejo que lo guardado no lo pisa, pero
// responde 200 igualmente para que la cola del cliente lo dé por entregado.
export async function PUT(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/preparativos/[elemento]">) {
  const { id, elemento } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  // application/json obligatorio: defensa CSRF de las rutas que escriben.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: E.noJson }, { status: 415 });
  }
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: E.cuerpo }, { status: 400 });
  }
  const resultado = validarMarca(elemento, cuerpo);
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: 400 });
  try {
    await guardarMarca(supabase, id, elemento, resultado.marca);
    return NextResponse.json({ ok: true });
  } catch (fallo) {
    return respuestaFallo("PUT /api/plan/[id]/preparativos/[elemento]", fallo);
  }
}
