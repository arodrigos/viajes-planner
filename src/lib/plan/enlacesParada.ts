import { urlBusquedaSitio } from "./urlBusquedaSitio";

export interface EnlaceParada {
  etiqueta: string;
  href: string;
}

export interface ParadaConEnlaces {
  nombre: string;
  coordenadas?: { lat: number; lon: number };
  procedencia: { fuente: "propuesto-sin-verificar" | "osm" | "wikipedia"; url?: string };
}

const PREFIJO_MAPS_COORDENADAS = "https://www.google.com/maps/search/?api=1&query=";

// La URL de la fuente viene de la base de datos (Lugar.url), no de una lista
// cerrada en código: solo se enlaza si es https y de un host que esperamos
// para esa fuente, así un dato corrupto no se convierte en un enlace a otro
// sitio ni en un esquema peligroso.
function hostPermitido(fuente: "osm" | "wikipedia", host: string): boolean {
  return fuente === "osm" ? host === "www.openstreetmap.org" : host.endsWith(".wikipedia.org");
}

function urlFuenteSegura(fuente: "osm" | "wikipedia", url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parseada = new URL(url);
    return parseada.protocol === "https:" && hostPermitido(fuente, parseada.hostname) ? parseada.href : null;
  } catch {
    return null;
  }
}

export function enlacesDeParada(parada: ParadaConEnlaces, ciudad: string): EnlaceParada[] {
  const mapa: EnlaceParada = {
    etiqueta: "Ver en Google Maps",
    href: parada.coordenadas
      ? `${PREFIJO_MAPS_COORDENADAS}${parada.coordenadas.lat},${parada.coordenadas.lon}`
      : urlBusquedaSitio(parada.nombre, ciudad),
  };
  const enlaces = [mapa];

  const { fuente, url } = parada.procedencia;
  if (fuente !== "propuesto-sin-verificar") {
    const href = urlFuenteSegura(fuente, url);
    if (href) {
      const nombreFuente = fuente === "osm" ? "OpenStreetMap" : "Wikipedia";
      enlaces.push({ etiqueta: `Fuente: ${nombreFuente}`, href });
    }
  }
  return enlaces;
}
