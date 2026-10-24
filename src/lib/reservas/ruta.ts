import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERRORES_RESERVA as E } from "@/lib/textos/reservas";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { rolEnPlan } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";
import { validarReserva, type ContextoReserva, type ResultadoReserva } from "./validar";

// El cuerpo tiene que ser application/json: un formulario de otro origen no
// puede mandarlo sin un preflight CORS que el producto no concede (defensa CSRF
// de las rutas que escriben).
export async function leerCuerpoReserva(request: NextRequest, supabase: SupabaseClient, planId: string): Promise<{ resultado: ResultadoReserva } | { respuesta: Response }> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { respuesta: NextResponse.json({ error: E.noJson }, { status: 415 }) };
  }
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return { respuesta: NextResponse.json({ error: E.cuerpo }, { status: 400 }) };
  }
  return { resultado: validarReserva(cuerpo, await contextoDelViaje(supabase, planId)) };
}

async function contextoDelViaje(supabase: SupabaseClient, planId: string): Promise<ContextoReserva> {
  const plan = await recuperarPlan(supabase, planId).catch(() => null);
  const fechas = (plan?.dias ?? []).map((d) => d.fecha).sort();
  return fechas.length > 0 ? { viaje: { desde: fechas[0], hasta: fechas[fechas.length - 1] } } : {};
}

// Solo el texto del error, sin filas ni uuids, como el resto de rutas del plan.
export function respuestaFallo(ruta: string, fallo: unknown): Response {
  const detalle = (fallo instanceof Error ? fallo.message : "error desconocido").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 300);
  console.error(`${ruta}:`, detalle);
  return NextResponse.json({ error: E.interno }, { status: 500 });
}

export function mensajeErrores(errores: Record<string, string | undefined>): string {
  return Object.values(errores).find((m) => m) ?? E.cuerpo;
}

// Solo el dueño (trabajo no eliminado a su nombre). Un invitado, un ajeno y un
// plan inexistente reciben el mismo 404, sin ningún dato de la reserva.
export async function comoDuenyo(request: NextRequest, planId: string): Promise<SupabaseClient | Response> {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;
  const supabase = clienteServicio();
  const rol = await rolEnPlan(supabase, planId, sesion);
  if (!rol || rol.rol !== "duenyo") return NextResponse.json({ error: E.noEncontrada }, { status: 404 });
  return supabase;
}
