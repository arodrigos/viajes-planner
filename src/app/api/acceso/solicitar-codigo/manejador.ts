import { NextResponse } from "next/server";
import { clienteAnonimo } from "@/lib/db/cliente";
import { procesarSolicitudCodigo, type TipoRechazoAuth } from "@/lib/auth/solicitarCodigo";

export const MENSAJE_CODIGO_SOLICITADO =
  "Si tu correo está autorizado, te llegará un código en un minuto. Si no te llega, espera un minuto y vuelve a pedirlo.";

const RESPUESTA_UNIFORME = () => NextResponse.json({ ok: true, mensaje: MENSAJE_CODIGO_SOLICITADO });

// Lo que se habría devuelto si la respuesta no tuviera que ser uniforme.
// Solo va al log: operación distingue límite, dirección rechazada y fallo sin
// que el cliente lo pueda ver.
const HTTP_EQUIVALENTE: Record<TipoRechazoAuth, 429 | 400 | 502> = {
  "limite-envios": 429,
  "correo-invalido": 400,
  "fallo-envio": 502,
};

// pantalla-ac8(d): "enviado", "correo-no-permitido" y cualquier rechazo de
// Auth devuelven EXACTAMENTE la misma respuesta -mismo estado, mismo cuerpo-,
// así que no hay forma de distinguir desde fuera si un correo está en la
// lista blanca (un 429 o un 400 solo para autorizados lo delataría). Solo
// "configuracion-invalida" (lista blanca vacía, error del operador, nunca
// depende del correo pedido) se queda como 500 real.
export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };
  if (!email) return NextResponse.json({ error: "falta email" }, { status: 400 });

  const resultado = await procesarSolicitudCodigo(clienteAnonimo(), email);

  switch (resultado.estado) {
    case "rechazado-por-auth":
      // Nunca error.message ni el correo: llevan la dirección y detalles del proveedor.
      console.warn({
        evento: "solicitar-codigo-rechazado",
        tipo: resultado.tipo,
        http_equivalente: HTTP_EQUIVALENTE[resultado.tipo],
        status: resultado.status,
        code: resultado.code,
      });
      return RESPUESTA_UNIFORME();
    case "enviado":
    case "correo-no-permitido":
      return RESPUESTA_UNIFORME();
    case "configuracion-invalida":
      return NextResponse.json({ error: resultado.motivo }, { status: 500 });
  }
}
