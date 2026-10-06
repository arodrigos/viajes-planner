// Tipos del módulo de resolución de lugares (bloque lugares-resolucion).
// FuenteLugares es la interfaz que resolverPlan consume: una única
// implementación real (fuenteAbierta.ts, Nominatim + Wikipedia) y un doble
// de test con fixtures grabadas (fuenteGrabada.ts). Nada de esto se usa
// desde src/app -- solo desde el trabajador.

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
  // «clase=tipo» de Nominatim (p. ej. «tourism=museum»): lo que permite
  // deducir la categoría de una parada que el modelo no clasificó.
  clasificacion_osm?: string;
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

// cpn-ac1: tope de peticiones de RED a Nominatim que puede gastar la
// deducción de la ciudad de UN plan. Lo descuenta la propia fuente justo
// antes de salir a la red, así que una respuesta servida desde cache_sitios
// nunca lo consume. Es una clase distinta de FalloRedCiudad: «no me dejan
// preguntar más» no es «Nominatim no contestó».
export class PresupuestoAgotado extends Error {}

export interface PresupuestoPeticiones {
  // Reserva una petición de red; false si el presupuesto ya está agotado.
  consumir(): boolean;
  consumidas(): number;
}

export function crearPresupuestoPeticiones(maximo: number): PresupuestoPeticiones {
  let gastadas = 0;
  return {
    consumir() {
      if (gastadas >= maximo) return false;
      gastadas++;
      return true;
    },
    consumidas: () => gastadas,
  };
}

// dmc-ac1: lo que clasificarDestino necesita saber de un texto geocodificado
// entero: si es un país o una región y cuánto ocupa.
export interface ZonaGeocodificada {
  nombre: string;
  // `addresstype` de Nominatim: country, state, region, province, city...
  tipo: string;
  codigo_pais: string | null;
  caja: CajaDelimitadora;
  punto: { lat: number; lon: number };
}

// ciu-ac1/ciu-ac2/ciu-ac7: las dos operaciones nuevas que resolverCiudadEfectiva
// necesita. Deliberadamente separada de FuenteLugares -- añadir estos dos
// métodos a esa interfaz obligaría a todos los dobles de test existentes
// (object literals en resolverAlternativas.test.ts, barrido.integration.test.ts)
// a implementarlos aunque no tengan nada que ver con la ciudad del plan.
export interface FuenteCiudad {
  buscarLibre(nombre: string): Promise<CandidatoLugar[]>;
  geocodificarCiudad(nombre: string): Promise<CajaDelimitadora | null>;
  // cpn-ac1: la misma fuente (misma caché y mismo limitador) con sus
  // peticiones de red descontadas de este presupuesto. Opcional para que los
  // dobles de test que no hablan con red no tengan que implementarlo, y una
  // vista aparte para no cambiar la firma de los métodos existentes.
  // dmc-ac1: opcional por la misma razón que conPresupuesto. Lanza
  // FalloRedCiudad si no se pudo preguntar; null es «Nominatim no conoce ese
  // texto».
  geocodificarZona?(texto: string): Promise<ZonaGeocodificada | null>;
  conPresupuesto?(presupuesto: PresupuestoPeticiones): FuenteLugares & FuenteCiudad;
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
  // guia-abierta: el extracto que ya devuelve el mismo endpoint, para las
  // curiosidades; sin petición nueva.
  extracto?: string;
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
