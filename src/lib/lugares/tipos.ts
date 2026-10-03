// Tipos del módulo de resolución de lugares (bloque lugares-resolucion).
// FuenteLugares es la interfaz que resolverPlan consume: una única
// implementación real (fuenteAbierta.ts, Nominatim + Wikipedia) y un doble
// de test con fixtures grabadas (fuenteGrabada.ts). Nada de esto se usa
// desde src/app -- solo desde el trabajador de VPS1.

export interface CajaDelimitadora {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface EtiquetasLugar {
  opening_hours?: string;
  wikipedia?: string;
  wikidata?: string;
  website?: string;
}

export type FuenteCandidato = "osm" | "wikipedia";

export interface CandidatoLugar {
  fuente: FuenteCandidato;
  id: string;
  url: string;
  nombreFuente: string;
  nombresAlternativos: string[];
  lat: number;
  lon: number;
  categoriaOsm?: string;
  tipoOsm?: string;
  etiquetas: EtiquetasLugar;
}

// La única forma en que resolverPlan habla con un proveedor de lugares.
// geocodificarDestino se llama una vez por plan; buscarNominatim/
// buscarWikipedia una vez por parada (con caché y límite de ritmo ya
// aplicados dentro de la implementación real).
export interface FuenteLugares {
  geocodificarDestino(destino: string): Promise<CajaDelimitadora | null>;
  buscarNominatim(nombre: string, destino: string, bbox: CajaDelimitadora): Promise<CandidatoLugar[]>;
  buscarWikipedia(nombre: string, destino: string, bbox: CajaDelimitadora): Promise<CandidatoLugar[]>;
}
