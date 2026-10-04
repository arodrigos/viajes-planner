// dest-ac2: enlace determinista "Cómo llegar" a pie desde un punto
// (la última parada visitada del día, o la primera si ninguna lo está) a
// otro (la siguiente parada sin visitar). Mismo patrón sin clave y sin
// afiliación que urlRecorridoDia.ts -- aquí nunca hay más de un tramo
// porque solo son dos puntos.
import type { PuntoRecorrido } from "./urlRecorridoDia";

export function urlComoLlegar(origen: PuntoRecorrido, destino: PuntoRecorrido): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}&destination=${destino.lat},${destino.lon}&travelmode=walking`;
}
