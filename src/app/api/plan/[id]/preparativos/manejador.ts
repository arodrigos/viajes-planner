import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { listarMarcas } from "@/lib/preparativos/repositorio";
import { comoDuenyo, respuestaFallo } from "@/lib/reservas/ruta";

// Marcas de la lista de preparativos: revelan que viajan menores. Solo las lee
// el dueño; invitado, ajeno e inexistente reciben el mismo 404.
export async function GET(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/preparativos">) {
  const { id } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  try {
    return NextResponse.json({ marcas: await listarMarcas(supabase, id) }, { headers: { "cache-control": "no-store" } });
  } catch (fallo) {
    return respuestaFallo("GET /api/plan/[id]/preparativos", fallo);
  }
}
