// lug-ac2: regla de aceptación determinista y testeable. Nunca se acepta
// un pin solo porque Nominatim/Wikipedia devolvieron ALGO: tiene que caer
// dentro del destino, llamarse parecido y ser de un tipo compatible con la
// categoría que el modelo propuso.
import type { CajaDelimitadora, CandidatoLugar } from "./tipos";
import { mejorSimilitud } from "./normalizar";

export const UMBRAL_SIMILITUD = 0.6;

// Tabla cerrada categoría -> categorías OSM (`category`, antes `class`)
// compatibles. Vacía = "otro": no se restringe por tipo, solo por bbox y
// nombre. Un candidato cuya `categoriaOsm` no esté en la lista para una
// categoría no vacía se rechaza (p. ej. categoria=museo no acepta
// categoriaOsm=highway).
const CATEGORIAS_OSM_COMPATIBLES: Record<string, string[]> = {
  monumento: ["historic", "tourism"],
  museo: ["tourism"],
  parque: ["leisure", "boundary", "landuse"],
  mirador: ["tourism", "natural"],
  barrio: ["place", "boundary"],
  plaza: ["place", "highway", "leisure"],
  mercado: ["shop", "amenity"],
  playa: ["natural", "leisure"],
  naturaleza: ["natural", "leisure", "boundary"],
  "ocio-infantil": ["leisure", "tourism"],
  espectaculo: ["amenity", "tourism"],
  comida: ["amenity"],
  compras: ["shop"],
  otro: [],
};

export function categoriaCompatible(categoria: string | undefined, categoriaOsm: string | undefined): boolean {
  if (!categoria) return true;
  const permitidas = CATEGORIAS_OSM_COMPATIBLES[categoria];
  if (!permitidas || permitidas.length === 0) return true;
  if (!categoriaOsm) return true;
  return permitidas.includes(categoriaOsm);
}

export interface ResultadoAceptacion {
  aceptado: boolean;
  motivo?: string;
}

export function evaluarCandidato(
  nombreBuscado: string,
  candidato: CandidatoLugar,
  bbox: CajaDelimitadora,
  categoria?: string,
): ResultadoAceptacion {
  if (candidato.lat < bbox.minLat || candidato.lat > bbox.maxLat || candidato.lon < bbox.minLon || candidato.lon > bbox.maxLon) {
    return { aceptado: false, motivo: "fuera del bounding box del destino" };
  }

  const similitud = mejorSimilitud(nombreBuscado, [candidato.nombreFuente, ...candidato.nombresAlternativos]);
  if (similitud < UMBRAL_SIMILITUD) {
    return { aceptado: false, motivo: `similitud de nombre insuficiente (${similitud.toFixed(2)} < ${UMBRAL_SIMILITUD})` };
  }

  if (!categoriaCompatible(categoria, candidato.categoriaOsm)) {
    return {
      aceptado: false,
      motivo: `categoría OSM '${candidato.categoriaOsm}' incompatible con categoría '${categoria}'`,
    };
  }

  return { aceptado: true };
}

// El primer candidato que acepta la regla, en el orden que devolvió la
// fuente (Nominatim ya ordena por relevancia/importancia).
export function elegirMejorCandidato(
  nombreBuscado: string,
  candidatos: CandidatoLugar[],
  bbox: CajaDelimitadora,
  categoria?: string,
): { candidato: CandidatoLugar; motivo?: string } | { candidato: null; motivo: string } {
  for (const candidato of candidatos) {
    const resultado = evaluarCandidato(nombreBuscado, candidato, bbox, categoria);
    if (resultado.aceptado) return { candidato };
  }
  return { candidato: null, motivo: "ningún candidato aceptable" };
}
