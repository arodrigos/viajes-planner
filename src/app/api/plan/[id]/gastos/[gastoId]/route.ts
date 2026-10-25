import { NextRequest, NextResponse } from "next/server";
import { borrarGasto, contarGastos, existeGastoEnPlan, GastoDeOtroPlan, guardarGasto } from "@/lib/gastos/repositorio";
import { comoDuenyo, leerCuerpoGasto, mensajeErrores, respuestaFallo } from "@/lib/gastos/ruta";
import { TOPE_GASTOS } from "@/lib/gastos/tipos";
import { esUuid } from "@/lib/gastos/validar";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";


// Upsert idempotente: el id lo genera el cliente, así que repetir el PUT (un
// reintento tras un corte de red) no duplica, y uno más viejo que lo guardado
// no lo pisa. Siempre 200 si es válido.
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/gastos/[gastoId]">) {
  const { id, gastoId } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  if (!esUuid(gastoId)) return NextResponse.json({ error: E.cuerpo }, { status: 400 });
  try {
    const leido = await leerCuerpoGasto(request, supabase, id);
    if ("respuesta" in leido) return leido.respuesta;
    if (!leido.resultado.ok) return NextResponse.json({ error: mensajeErrores(leido.resultado.errores), errores: leido.resultado.errores }, { status: 400 });
    if ((await contarGastos(supabase, id)) >= TOPE_GASTOS && !(await existeGastoEnPlan(supabase, id, gastoId))) {
      return NextResponse.json({ error: E.tope }, { status: 409 });
    }
    await guardarGasto(supabase, id, gastoId, leido.resultado.gasto);
    return NextResponse.json({ ok: true });
  } catch (fallo) {
    if (fallo instanceof GastoDeOtroPlan) return NextResponse.json({ error: E.otroPlan }, { status: 400 });
    return respuestaFallo("PUT /api/plan/[id]/gastos/[gastoId]", fallo);
  }
}

// 204 exista o no el gasto: borrar dos veces es lo mismo que borrar una.
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/gastos/[gastoId]">) {
  const { id, gastoId } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  if (!esUuid(gastoId)) return new NextResponse(null, { status: 204 });
  try {
    await borrarGasto(supabase, id, gastoId);
    return new NextResponse(null, { status: 204 });
  } catch (fallo) {
    return respuestaFallo("DELETE /api/plan/[id]/gastos/[gastoId]", fallo);
  }
}
