import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";
import { recuperarPlan } from "@/lib/plan/repositorio";
import { comoDuenyo, respuestaFallo } from "@/lib/reservas/ruta";
import { validarGasto, type ResultadoGasto } from "./validar";

// Mismo control de dueño y misma salida de errores que las reservas.
export { comoDuenyo, respuestaFallo };

export function mensajeErrores(errores: Record<string, string | undefined>): string {
  return Object.values(errores).find((m) => m) ?? E.cuerpo;
}

// application/json obligatorio: defensa CSRF de las rutas que escriben.
export async function leerCuerpoGasto(request: NextRequest, supabase: SupabaseClient, planId: string): Promise<{ resultado: ResultadoGasto } | { respuesta: Response }> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { respuesta: NextResponse.json({ error: E.noJson }, { status: 415 }) };
  }
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return { respuesta: NextResponse.json({ error: E.cuerpo }, { status: 400 }) };
  }
  // Los mismos días que ofrece el formulario. Si el plan no se puede leer, el
  // fallo sube a la ruta (500): aceptar sin comprobar guardaría días ajenos al viaje.
  const plan = await recuperarPlan(supabase, planId);
  return { resultado: validarGasto(cuerpo, { fechasViaje: (plan?.dias ?? []).map((d) => d.fecha) }) };
}
