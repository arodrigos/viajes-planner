// Entrada y errores de los sitios que el usuario añade a un día. Las mismas
// reglas viven en las funciones SQL (anadir/corregir_sitio_propio): aquí se
// aplican antes para dar un mensaje claro, allí para que ninguna otra vía
// pueda saltárselas.
export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 80;
export const NOTA_MAX = 200;

export const MENSAJES_SITIO = {
  nombre: "El nombre tiene que tener entre 2 y 80 caracteres",
  nota: "La nota no puede pasar de 200 caracteres",
  dia: "Ese día no existe en el plan",
  version: "La versión del plan no es válida",
  noPropia: "Solo se pueden cambiar los sitios que añadiste tú",
  desfasada: "El plan ha cambiado desde que lo abriste. Recarga y vuelve a intentarlo.",
  pendientes: "Hay 20 sitios esperando a que los busquemos. Espera a que terminen antes de añadir más.",
  interno: "No se ha podido guardar el sitio.",
} as const;

// Caracteres de control (incluidos saltos de línea y tabuladores): ni el
// nombre ni la nota son multilínea, y así nada raro llega al .ics ni a la
// infografía.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function limpiarTexto(texto: string): string {
  return texto.replace(CONTROL, "").trim();
}

// Postgres cuenta caracteres, no unidades UTF-16: un emoji es uno.
export function longitud(texto: string): number {
  return Array.from(texto).length;
}

export interface SitioValido {
  nombre: string;
  nota: string | null;
}

export function validarSitio(nombre: unknown, nota: unknown, conNota: boolean): SitioValido | { error: string } {
  if (typeof nombre !== "string") return { error: MENSAJES_SITIO.nombre };
  const limpio = limpiarTexto(nombre);
  if (longitud(limpio) < NOMBRE_MIN || longitud(limpio) > NOMBRE_MAX) return { error: MENSAJES_SITIO.nombre };
  if (!conNota || nota === undefined || nota === null) return { nombre: limpio, nota: null };
  if (typeof nota !== "string") return { error: MENSAJES_SITIO.nota };
  const notaLimpia = limpiarTexto(nota);
  if (longitud(notaLimpia) > NOTA_MAX) return { error: MENSAJES_SITIO.nota };
  return { nombre: limpio, nota: notaLimpia === "" ? null : notaLimpia };
}

export interface ErrorSitio {
  status: number;
  error: string;
}

// Traduce el `raise exception` de la función SQL al estado HTTP; null si el
// fallo no es uno de los previstos.
// Un 23505 es la colisión con el clon de un trabajador que se llevó la versión
// siguiente: para la persona es lo mismo que una versión desfasada.
export function errorDeFuncionSitio(error: string | { message: string; code?: string }): ErrorSitio | null {
  const mensaje = typeof error === "string" ? error : error.message;
  const code = typeof error === "string" ? undefined : error.code;
  if (code === "23505" || mensaje.includes("version-desfasada")) return { status: 409, error: MENSAJES_SITIO.desfasada };
  if (mensaje.includes("demasiados-pendientes")) return { status: 429, error: MENSAJES_SITIO.pendientes };
  if (mensaje.includes("dia-invalido")) return { status: 400, error: MENSAJES_SITIO.dia };
  if (mensaje.includes("no-es-propia")) return { status: 400, error: MENSAJES_SITIO.noPropia };
  if (mensaje.includes("sitio-invalido")) return { status: 400, error: MENSAJES_SITIO.nombre };
  return null;
}
