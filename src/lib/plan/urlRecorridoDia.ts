// map-ac3: enlace determinista "Abrir el recorrido en Google Maps", sin
// clave y sin afiliación (mismo patrón que urlBusquedaSitio.ts). Solo
// coordenadas numéricas de paradas YA RESUELTAS entran aquí -nunca texto
// libre del modelo-, así que la URL nunca necesita encodeURIComponent.
//
// Partido en tramos porque los navegadores móviles de Google Maps limitan
// a 3 los waypoints intermedios por enlace (9 en el resto): un tramo cubre
// como mucho 5 paradas (origen + 3 intermedias + destino) y el siguiente
// tramo arranca en la última parada del anterior, para que el recorrido
// completo se pueda seguir enlace a enlace sin perder continuidad.
export interface PuntoRecorrido {
  lat: number;
  lon: number;
}

export interface TramoRecorrido {
  etiqueta: string;
  href: string;
}

const MAX_WAYPOINTS_INTERMEDIOS = 3;
const TAMANO_TRAMO = MAX_WAYPOINTS_INTERMEDIOS + 2; // origen + intermedias + destino

function formatoPunto(punto: PuntoRecorrido): string {
  return `${punto.lat},${punto.lon}`;
}

export function urlRecorridoDia(puntos: PuntoRecorrido[]): TramoRecorrido[] {
  if (puntos.length < 2) return [];

  const tramos: TramoRecorrido[] = [];
  const necesitaTramos = puntos.length > TAMANO_TRAMO;
  let inicio = 0;
  let numeroTramo = 1;

  while (inicio < puntos.length - 1) {
    const fin = Math.min(inicio + TAMANO_TRAMO - 1, puntos.length - 1);
    const segmento = puntos.slice(inicio, fin + 1);
    const origen = segmento[0];
    const destino = segmento[segmento.length - 1];
    const intermedias = segmento.slice(1, -1);

    let href = `https://www.google.com/maps/dir/?api=1&origin=${formatoPunto(origen)}&destination=${formatoPunto(destino)}`;
    if (intermedias.length > 0) {
      href += `&waypoints=${intermedias.map(formatoPunto).join("|")}`;
    }
    href += "&travelmode=walking";

    tramos.push({
      etiqueta: necesitaTramos
        ? `Tramo ${numeroTramo}: paradas ${inicio + 1}–${fin + 1}`
        : "Abrir el recorrido en Google Maps",
      href,
    });

    numeroTramo++;
    inicio += TAMANO_TRAMO - 1;
  }

  return tramos;
}
