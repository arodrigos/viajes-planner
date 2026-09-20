// Bandera de "hay un envío esperando sesión", separada a propósito del
// borrador (borrador.ts): el borrador es el contenido del formulario y
// sobrevive siempre; esta bandera es solo la intención de reenviar en
// cuanto haya sesión, y se borra en cuanto se cumple o se abandona.
const CLAVE = "viajes-planner:envio-pendiente";

export function marcarEnvioPendiente(): void {
  window.localStorage.setItem(CLAVE, "1");
}

export function hayEnvioPendiente(): boolean {
  return window.localStorage.getItem(CLAVE) === "1";
}

export function limpiarEnvioPendiente(): void {
  window.localStorage.removeItem(CLAVE);
}
