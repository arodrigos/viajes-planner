// El aviso solo distingue «el servidor no pudo» de «no hay red»: es lo único
// que llega al cliente sin romper la respuesta uniforme de solicitar-codigo,
// así que nunca depende del status ni del cuerpo (no delata la lista blanca).
export const AVISO_REENVIO_SERVIDOR =
  "No se ha podido enviar otro código. Inténtalo de nuevo en un momento. Si ya te llegó un código, puedes seguir usándolo mientras no caduque.";
export const AVISO_REENVIO_RED =
  "No se ha podido enviar otro código: parece que no hay conexión. Compruébala e inténtalo de nuevo. Si ya te llegó un código, puedes seguir usándolo mientras no caduque.";

export function mensajeFalloReenvio(fallo: { tipo: "respuesta"; status: number } | { tipo: "red" }): string {
  return fallo.tipo === "red" ? AVISO_REENVIO_RED : AVISO_REENVIO_SERVIDOR;
}
