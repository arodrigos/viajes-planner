import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { pedirCiudadManual } from "@/lib/plan/ciudadManual";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";

// man-ac3: textos exactos del diseño, también usados por
// src/app/plan/[id]/__tests__/avisoCiudad.test.tsx para comprobar que la
// vista los reproduce sin alterarlos.
export const MENSAJE_NOMBRE_VACIO = "Escribe el nombre de una ciudad";
export const MENSAJE_DEMASIADO_PRONTO = "Ya nos has dicho la ciudad hace poco: inténtalo dentro de un rato";

function leerNombre(cuerpo: unknown): string | null {
  const valor = (cuerpo as { nombre?: unknown })?.nombre;
  return typeof valor === "string" ? valor : null;
}

// man-ac4: mismo criterio que visitas/route.ts y sustituir/route.ts -- un
// plan ajeno, inexistente o con el trabajo marcado eliminado responde 404
// con el mismo cuerpo exacto, nunca 403 ni un 404 distinto.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/ciudad">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const esPropio = await planPerteneceAUsuario(supabase, id, sesion.usuarioId);
  if (!esPropio) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo de la petición no es JSON válido" }, { status: 400 });
  }
  const nombre = leerNombre(cuerpo);
  if (nombre === null) return NextResponse.json({ error: "falta 'nombre'" }, { status: 400 });

  const resultado = await pedirCiudadManual(supabase, id, nombre);
  if (resultado.estado === "nombre-vacio") return NextResponse.json({ error: MENSAJE_NOMBRE_VACIO }, { status: 400 });
  if (resultado.estado === "demasiado-pronto") return NextResponse.json({ error: MENSAJE_DEMASIADO_PRONTO }, { status: 429 });
  return NextResponse.json({ ok: true });
}
