// Tipos del módulo de resolución de lugares (bloque lugares-resolucion).
// FuenteLugares es la interfaz que resolverPlan consume: una única
// implementación real (fuenteAbierta.ts, Nominatim + Wikipedia) y un doble
// de test con fixtures grabadas (fuenteGrabada.ts). Nada de esto se usa
// desde src/app -- solo desde el trabajador de VPS1.

import type { Foto } from "@/lib/plan/tipos";

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

// ciu-ac2: desglose de dirección de Nominatim (addressdetails=1), solo los
// niveles que la votación por niveles de ciudad.ts necesita -- nunca se usa
// para mostrar nada, solo para deducir la ciudad efectiva.
export interface DireccionLugar {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state_district?: string;
  county?: string;
  // Verificado contra la API real de Nominatim el 2026-10-04 (issue de
  // calibración del gatekeeper): para Londres NO devuelve state_district
  // ni county, devuelve estos tres -- borough ("London Borough of Tower
  // Hamlets"), city_district ("Camden", "Kensington y Chelsea") y suburb
  // ("Bloomsbury"). Sin ellos, el nivel "distrito" de ciudad.ts está
  // siempre vacío para cualquier parada londinense.
  borough?: string;
  city_district?: string;
  suburb?: string;
  state?: string;
  region?: string;
}

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
  direccion?: DireccionLugar;
}

// ciu-ac1/ciu-ac7: distingue un fallo de red genuino (reintentado y agotado)
// de una respuesta negativa bien formada -- resolverCiudadEfectiva necesita
// la diferencia para no confundir "Nominatim no contestó" con "no hay
// ciudad", que son conclusiones completamente distintas sobre el plan.
export class FalloRedCiudad extends Error {}

// ciu-ac1/ciu-ac2/ciu-ac7: las dos operaciones nuevas que resolverCiudadEfectiva
// necesita. Deliberadamente separada de FuenteLugares -- añadir estos dos
// métodos a esa interfaz obligaría a todos los dobles de test existentes
// (object literals en resolverAlternativas.test.ts, barrido.integration.test.ts)
// a implementarlos aunque no tengan nada que ver con la ciudad del plan.
export interface FuenteCiudad {
  buscarLibre(nombre: string): Promise<CandidatoLugar[]>;
  geocodificarCiudad(nombre: string): Promise<CajaDelimitadora | null>;
}

// La única forma en que resolverPlan habla con un proveedor de lugares.
// geocodificarDestino se llama una vez por plan; buscarNominatim/
// buscarWikipedia una vez por parada (con caché y límite de ritmo ya
// aplicados dentro de la implementación real).
export interface FuenteLugares {
  geocodificarDestino(destino: string): Promise<CajaDelimitadora | null>;
  // ciu-ac3: "cualificador", nunca "destino" -- es el texto que acompaña al
  // nombre de la parada en la búsqueda y en la clave de caché, y desde este
  // bloque es la ciudad efectiva del plan, no el destino en bruto.
  buscarNominatim(nombre: string, cualificador: string, bbox: CajaDelimitadora): Promise<CandidatoLugar[]>;
  buscarWikipedia(nombre: string, cualificador: string, bbox: CajaDelimitadora): Promise<CandidatoLugar[]>;
}

// bloque fotos-paradas: el resumen de una página de Wikipedia, reducido a
// lo único que resolverFoto necesita de ella -el nombre de fichero de su
// imagen original en Commons, si tiene una-.
export interface ResumenPaginaWikipedia {
  fichero?: string;
}

export interface CandidatoGeosearch {
  lang: string;
  titulo: string;
}

// La única forma en que resolverFoto (resolverFotos.ts) habla con un
// proveedor de fotos: tres operaciones primitivas, cada una testeable por
// separado con un doble de fixtures (fuenteFotosGrabada.ts), igual que
// FuenteLugares arriba.
export interface FuenteFotos {
  resumenPagina(lang: string, titulo: string): Promise<ResumenPaginaWikipedia | null>;
  infoImagen(fichero: string): Promise<Foto | null>;
  geosearch(lat: number, lon: number): Promise<CandidatoGeosearch[]>;
}
