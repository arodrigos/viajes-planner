// Interpreta en local lo que el usuario pega para ubicar el hotel. Nunca
// geocodifica ni hace peticiones: el brief prohíbe mandar datos de reserva a
// Nominatim o a cualquier otra API.
export interface Coordenadas {
  lat: number;
  lon: number;
}

const NUM = "(-?\\d{1,3}(?:[.,]\\d+)?)";
// Texto de «lat, lon» sin más (con coma, punto y coma o espacio de separador).
const PAREJA = new RegExp(`^\\s*${NUM}\\s*[,;\\s]\\s*${NUM}\\s*$`);
// Google Maps (@lat,lon,zoom y !3dLAT!4dLON), OpenStreetMap (#map=z/lat/lon,
// mlat/mlon) y Apple Maps / geo: (ll=lat,lon, q=lat,lon, geo:lat,lon).
const PATRONES_ENLACE: RegExp[] = [
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,
  /[?&]mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/,
  /[?&](?:ll|q|query|sll)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/i,
  /geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
];

function enRango(lat: number, lon: number): Coordenadas | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export function interpretarUbicacion(texto: string): Coordenadas | null {
  if (typeof texto !== "string" || texto.length > 2000) return null;
  const pareja = PAREJA.exec(texto);
  if (pareja) return enRango(parseFloat(pareja[1].replace(",", ".")), parseFloat(pareja[2].replace(",", ".")));
  for (const patron of PATRONES_ENLACE) {
    const m = patron.exec(texto);
    if (m) {
      const c = enRango(parseFloat(m[1]), parseFloat(m[2]));
      if (c) return c;
    }
  }
  return null;
}
