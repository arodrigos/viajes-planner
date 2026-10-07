import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { conCupo } from "@/lib/google/cupo";
import { buscarFicha, marcarObsoleto } from "@/lib/google/ficha";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";

const SIN_CACHE = { "cache-control": "no-store" };

// Parada ajena e inexistente comparten cuerpo byte a byte: no se confirma
// desde fuera que un identificador existe.
function noEncontrado() {
  return NextResponse.json({ error: "no encontrado" }, { status: 404, headers: SIN_CACHE });
}

interface Cuerpo {
  planId: string;
  paradaId: string;
  obsoleto: boolean;
}

function leerCuerpo(valor: unknown): Cuerpo | null {
  const c = valor as { planId?: unknown; paradaId?: unknown; obsoleto?: unknown } | null;
  if (typeof c?.planId !== "string" || !c.planId || typeof c.paradaId !== "string" || !c.paradaId) return null;
  return { planId: c.planId, paradaId: c.paradaId, obsoleto: c.obsoleto === true };
}

// Único camino por el que el place_id llega al navegador, y solo tras
// reservar una carga de UI Kit: el HTML de la página solo lleva el estado.
export async function POST(request: NextRequest) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  let cuerpo: Cuerpo | null;
  try {
    cuerpo = leerCuerpo(await request.json());
  } catch {
    cuerpo = null;
  }
  if (!cuerpo) return NextResponse.json({ error: "faltan 'planId' y 'paradaId'" }, { status: 400, headers: SIN_CACHE });

  const supabase = clienteServicio();
  if (!(await planPerteneceAUsuario(supabase, cuerpo.planId, sesion.usuarioId))) return noEncontrado();

  const ficha = await buscarFicha(supabase, cuerpo.planId, cuerpo.paradaId);
  if (ficha.tipo === "no-encontrada") return noEncontrado();
  if (ficha.tipo === "sin-ficha") return NextResponse.json({ motivo: "sin-ficha" }, { status: 404, headers: SIN_CACHE });

  // NOT_FOUND de Google: no cuesta cupo, solo pide al trabajador que vuelva a casar.
  if (cuerpo.obsoleto) {
    await marcarObsoleto(supabase, ficha.clave);
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  }

  const reserva = await conCupo(supabase, "ui_kit", sesion.usuarioId, async () => ficha.placeId);
  if (!reserva.concedido) {
    if (reserva.motivo === "error-reserva") return NextResponse.json({ motivo: "cupo-no-disponible" }, { status: 503, headers: SIN_CACHE });
    return NextResponse.json({ motivo: "cupo-agotado" }, { status: 429, headers: SIN_CACHE });
  }
  return NextResponse.json({ placeId: reserva.valor }, { headers: SIN_CACHE });
}
