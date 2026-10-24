import { NextRequest, NextResponse } from "next/server";
import { contarReservas, crearReserva, listarReservas } from "@/lib/reservas/repositorio";
import { comoDuenyo, leerCuerpoReserva, mensajeErrores, respuestaFallo } from "@/lib/reservas/ruta";
import { TOPE_RESERVAS } from "@/lib/reservas/tipos";
import { TEXTOS_RESERVAS } from "@/lib/textos/reservas";

// Reservas del viaje: datos personales (localizador, horas, hotel). Solo las
// lee y escribe el dueño; un invitado o un ajeno recibe el mismo 404 que para
// un plan que no existe. Ninguna de estas rutas toca el plan ni crea versión.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/reservas">) {
  const { id } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  try {
    return NextResponse.json(await listarReservas(supabase, id), { headers: { "cache-control": "no-store" } });
  } catch (fallo) {
    return respuestaFallo("GET /api/plan/[id]/reservas", fallo);
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/reservas">) {
  const { id } = await ctx.params;
  const supabase = await comoDuenyo(request, id);
  if (supabase instanceof Response) return supabase;
  try {
    const leido = await leerCuerpoReserva(request, supabase, id);
    if ("respuesta" in leido) return leido.respuesta;
    if (!leido.resultado.ok) return NextResponse.json({ error: mensajeErrores(leido.resultado.errores), errores: leido.resultado.errores }, { status: 400 });
    if ((await contarReservas(supabase, id)) >= TOPE_RESERVAS) return NextResponse.json({ error: TEXTOS_RESERVAS.tope }, { status: 409 });
    return NextResponse.json(await crearReserva(supabase, id, leido.resultado.reserva), { status: 201 });
  } catch (fallo) {
    return respuestaFallo("POST /api/plan/[id]/reservas", fallo);
  }
}
