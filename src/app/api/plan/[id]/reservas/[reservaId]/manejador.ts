import type { ContextoRuta } from "@/lib/api/contexto";
import { NextRequest, NextResponse } from "next/server";
import { actualizarReserva, borrarReserva } from "@/lib/reservas/repositorio";
import { comoDuenyo, leerCuerpoReserva, mensajeErrores, respuestaFallo } from "@/lib/reservas/ruta";
import { ERRORES_RESERVA } from "@/lib/textos/reservas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noEncontrada = () => NextResponse.json({ error: ERRORES_RESERVA.noEncontrada }, { status: 404 });

// PATCH sustituye la reserva entera (el formulario manda todos sus campos):
// así un campo vaciado se borra y no queda un resto de la versión anterior.
export async function PATCH(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/reservas/[reservaId]">) {
  const { id, reservaId } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  if (!UUID.test(reservaId)) return noEncontrada();
  try {
    const leido = await leerCuerpoReserva(request, supabase, id);
    if ("respuesta" in leido) return leido.respuesta;
    if (!leido.resultado.ok) return NextResponse.json({ error: mensajeErrores(leido.resultado.errores), errores: leido.resultado.errores }, { status: 400 });
    const reserva = await actualizarReserva(supabase, id, reservaId, leido.resultado.reserva);
    return reserva ? NextResponse.json(reserva) : noEncontrada();
  } catch (fallo) {
    return respuestaFallo("PATCH /api/plan/[id]/reservas/[reservaId]", fallo);
  }
}

export async function DELETE(request: NextRequest, ctx: ContextoRuta<"/api/plan/[id]/reservas/[reservaId]">) {
  const { id, reservaId } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  if (!UUID.test(reservaId)) return noEncontrada();
  try {
    return (await borrarReserva(supabase, id, reservaId)) ? new NextResponse(null, { status: 204 }) : noEncontrada();
  } catch (fallo) {
    return respuestaFallo("DELETE /api/plan/[id]/reservas/[reservaId]", fallo);
  }
}
