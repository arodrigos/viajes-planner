import { NextResponse } from "next/server";
import { clienteAnonimo } from "@/lib/db/cliente";
import { procesarSolicitudCodigo } from "@/lib/auth/solicitarCodigo";

// pantalla-ac8(d): "enviado" y "correo-no-permitido" devuelven EXACTAMENTE
// la misma respuesta -mismo estado, mismo cuerpo-, así que no hay forma de
// distinguir desde fuera si un correo está en la lista blanca. Solo
// "configuracion-invalida" (lista blanca vacía, error del operador, nunca
// depende del correo pedido) se queda como 500 real.
export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "falta email" }, { status: 400 });

  const resultado = await procesarSolicitudCodigo(clienteAnonimo(), email);

  switch (resultado.estado) {
    case "enviado":
    case "correo-no-permitido":
      return NextResponse.json({ ok: true });
    case "configuracion-invalida":
      return NextResponse.json({ error: resultado.motivo }, { status: 500 });
  }
}
