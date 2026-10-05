import type { CajaDelimitadora, FuenteCiudad, ZonaGeocodificada } from "@/lib/lugares/tipos";
import { MAX_ETAPAS } from "./reglas";

export type Zona = ZonaGeocodificada;

export type ClasificacionDestino =
  | { modo: "ciudad" }
  // `pedidas` cuenta los trozos del texto aunque solo se geocodifiquen los
  // seis primeros: es lo que dice cuántos países ha pedido el viajero.
  | { modo: "multiciudad"; zonas: Zona[]; pedidas: number };

const GRADOS_REGION_GRANDE = 2;
const TIPOS_REGION = new Set(["state", "region", "province"]);
const SEPARADORES = /\s*,\s*|\s+y\s+|\s+e\s+|\s*\+\s*|\s*\/\s*/i;

function extension(caja: CajaDelimitadora): number {
  return Math.max(caja.maxLat - caja.minLat, caja.maxLon - caja.minLon);
}

export function esZonaGrande(zona: Zona): boolean {
  if (zona.tipo === "country") return true;
  return TIPOS_REGION.has(zona.tipo) && extension(zona.caja) > GRADOS_REGION_GRANDE;
}

// Peticiones a Nominatim: 1 para el texto entero y, solo si no es una zona,
// una por trozo (como mucho 6). «Bosnia y Herzegovina» se resuelve entero
// como país y por eso nunca llega a partirse por su « y ». Cualquier fallo
// de red, o una fuente que no sabe geocodificar zonas, da modo ciudad: el
// flujo de siempre decide después, y el viaje nunca se aborta por esto.
export async function clasificarDestino(fuente: FuenteCiudad, destino: string): Promise<ClasificacionDestino> {
  const geocodificar = fuente.geocodificarZona?.bind(fuente);
  const texto = destino.trim();
  if (!geocodificar || texto.length === 0) return { modo: "ciudad" };

  try {
    const entera = await geocodificar(texto);
    if (entera && esZonaGrande(entera)) return { modo: "multiciudad", zonas: [entera], pedidas: 1 };

    const trozos = texto.split(SEPARADORES).map((t) => t.trim()).filter((t) => t.length > 0);
    if (trozos.length < 2) return { modo: "ciudad" };

    const zonas: Zona[] = [];
    for (const trozo of trozos.slice(0, MAX_ETAPAS)) {
      const zona = await geocodificar(trozo);
      if (!zona || !esZonaGrande(zona)) return { modo: "ciudad" };
      zonas.push(zona);
    }
    return { modo: "multiciudad", zonas, pedidas: trozos.length };
  } catch {
    return { modo: "ciudad" };
  }
}
