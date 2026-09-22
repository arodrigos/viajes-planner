// reco-ac2: la única función que decide a dónde enlaza una recomendación.
// El modelo nunca aporta una URL (ver tipos.ts, Recomendacion); esto es lo
// que la sustituye, con un prefijo LITERAL de Google Maps URLs -sin clave,
// sin coste, sin parámetro de afiliación- y encodeURIComponent sobre el
// texto completo, de modo que nada de lo que traiga "nombre" (ni siquiera
// otra URL) puede cambiar el destino del enlace: se codifica como texto de
// búsqueda, nunca se interpreta.
const PREFIJO_BUSQUEDA_MAPS = "https://www.google.com/maps/search/?api=1&query=";

export function urlBusquedaSitio(nombre: string, destino: string): string {
  return `${PREFIJO_BUSQUEDA_MAPS}${encodeURIComponent(`${nombre} ${destino}`)}`;
}
