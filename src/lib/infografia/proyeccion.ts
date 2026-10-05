// inf-ac2: proyecta coordenadas a un recuadro sin mapa base. Puro, para
// comprobar con property tests que ningún punto se sale del recuadro.
export interface Punto {
  lat: number;
  lon: number;
}

export interface Recuadro {
  ancho: number;
  alto: number;
  margen: number;
}

export interface PuntoPlano {
  x: number;
  y: number;
}

// Un solo punto, o varios casi coincidentes, no tienen extensión útil: se
// centran en vez de ampliar un ruido de metros hasta ocupar el recuadro.
const EXTENSION_MINIMA_GRADOS = 0.05;

export function proyectarRuta(puntos: Punto[], recuadro: Recuadro): PuntoPlano[] {
  if (puntos.length === 0) return [];
  const { ancho, alto, margen } = recuadro;
  const utilAncho = Math.max(0, ancho - 2 * margen);
  const utilAlto = Math.max(0, alto - 2 * margen);
  const lats = puntos.map((p) => p.lat);
  const lons = puntos.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latMedia = (minLat + maxLat) / 2;
  // Equirectangular con la longitud corregida por la latitud media: los
  // viajes son de un país, la distorsión no importa y la forma sí.
  const factorLon = Math.cos((latMedia * Math.PI) / 180);
  const extensionX = Math.max((maxLon - minLon) * factorLon, EXTENSION_MINIMA_GRADOS);
  const extensionY = Math.max(maxLat - minLat, EXTENSION_MINIMA_GRADOS);
  const escala = Math.min(utilAncho / extensionX, utilAlto / extensionY);
  const centroX = ((minLon + maxLon) / 2) * factorLon;
  const centroY = (minLat + maxLat) / 2;
  return puntos.map((p) => ({
    x: Math.min(ancho - margen, Math.max(margen, ancho / 2 + (p.lon * factorLon - centroX) * escala)),
    y: Math.min(alto - margen, Math.max(margen, alto / 2 - (p.lat - centroY) * escala)),
  }));
}
