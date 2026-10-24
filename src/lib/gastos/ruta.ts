import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";
import { comoDuenyo, respuestaFallo } from "@/lib/reservas/ruta";
import { validarGasto, type ResultadoGasto } from "./validar";

// Mismo control de dueño y misma salida de errores que las reservas.
export { comoDuenyo, respuestaFallo };

export function mensajeErrores(errores: Record<string, string | undefined>): string {
  return Object.values(errores).find((m) => m) ?? E.cuerpo;
}

// application/json obligatorio: defensa CSRF de las rutas que escriben.
export async function leerCuerpoGasto(request: NextRequest): Promise<{ resultado: ResultadoGasto } | { respuesta: Response }> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { respuesta: NextResponse.json({ error: E.noJson }, { status: 415 }) };
  }
  try {
    return { resultado: validarGasto(await request.json()) };
  } catch {
    return { respuesta: NextResponse.json({ error: E.cuerpo }, { status: 400 }) };
  }
}
