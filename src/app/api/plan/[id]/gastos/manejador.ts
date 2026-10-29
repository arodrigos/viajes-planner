import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { listarGastos } from "@/lib/gastos/repositorio";
import { comoDuenyo, respuestaFallo } from "@/lib/gastos/ruta";

// Gastos del viaje: datos personales. Solo los lee el dueño; un invitado o un
// ajeno recibe el mismo 404 que para un plan que no existe.
export async function GET(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/gastos">) {
  const { id } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  try {
    return NextResponse.json(await listarGastos(supabase, id), { headers: { "cache-control": "no-store" } });
  } catch (fallo) {
    return respuestaFallo("GET /api/plan/[id]/gastos", fallo);
  }
}
