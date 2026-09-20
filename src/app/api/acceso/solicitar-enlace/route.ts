import { NextResponse } from "next/server";
import { clienteAnonimo } from "@/lib/db/cliente";
import { procesarSolicitudEnlace } from "@/lib/auth/solicitarEnlace";

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "falta email" }, { status: 400 });

  const origen = new URL(request.url).origin;
  const resultado = await procesarSolicitudEnlace(clienteAnonimo(), email, origen);

  switch (resultado.estado) {
    case "enviado":
      return NextResponse.json({ ok: true });
    case "correo-no-permitido":
      return NextResponse.json({ error: "correo no autorizado" }, { status: 403 });
    case "configuracion-invalida":
      return NextResponse.json({ error: resultado.motivo }, { status: 500 });
  }
}
