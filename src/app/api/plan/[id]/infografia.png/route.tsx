import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { Lamina } from "@/lib/infografia/Lamina";
import { construirModeloInfografia } from "@/lib/infografia/modelo";
import { opcionesLamina } from "@/lib/infografia/opciones";
import { trabajoDelPlan } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";

// private, no-store: la imagen lleva los datos del viaje de un usuario.
const CABECERAS = { "Cache-Control": "private, no-store" };

// inf-ac1: misma guarda que el resto de rutas del plan -- ajeno e inexistente
// responden el mismo 404, byte a byte.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]/infografia.png">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();
  const noEncontrado = () => NextResponse.json({ error: "no encontrado" }, { status: 404, headers: CABECERAS });

  const trabajo = await trabajoDelPlan(supabase, id, sesion.usuarioId);
  if (!trabajo) return noEncontrado();
  const plan = await recuperarPlan(supabase, id);
  if (!plan) return noEncontrado();

  const modelo = construirModeloInfografia(plan, trabajo.presupuesto_eur ?? undefined);
  return new ImageResponse(<Lamina modelo={modelo} />, { ...opcionesLamina(), headers: CABECERAS });
}
