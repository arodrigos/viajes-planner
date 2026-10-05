// hor-ac3: @photostructure/tz-lookup pesa lo suyo (el índice de zonas) y solo
// se usa para calcular, nunca para pintar: por eso vive aquí, marcado como
// solo servidor, y la vista recibe el rango ya resuelto.
import "server-only";
import tzLookup from "@photostructure/tz-lookup";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { Parada } from "./tipos";

function zonaDeCoordenadas(lat: number, lon: number): string | null {
  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
}

// Coordenadas de la parada; si falta, el centro de la caja de su ciudad.
// Sin ninguna de las dos devuelve null: la apertura queda «desconocida» en
// vez de suponer una zona.
export function zonaDeParada(parada: Pick<Parada, "coordenadas">, caja?: CajaDelimitadora): string | null {
  if (parada.coordenadas) return zonaDeCoordenadas(parada.coordenadas.lat, parada.coordenadas.lon);
  if (caja) return zonaDeCoordenadas((caja.minLat + caja.maxLat) / 2, (caja.minLon + caja.maxLon) / 2);
  return null;
}
