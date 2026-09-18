import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { procesarSolicitudEnlace } from "@/lib/auth/solicitarEnlace";

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "falta email" }, { status: 400 });

  const supabase = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_ANON_KEY ?? "");
  const resultado = await procesarSolicitudEnlace(supabase, email);

  switch (resultado.estado) {
    case "enviado":
      return NextResponse.json({ ok: true });
    case "correo-no-permitido":
      return NextResponse.json({ error: "correo no autorizado" }, { status: 403 });
    case "configuracion-invalida":
      return NextResponse.json({ error: resultado.motivo }, { status: 500 });
  }
}
