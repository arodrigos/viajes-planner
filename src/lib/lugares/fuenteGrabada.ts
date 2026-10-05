import { FalloRedCiudad, type CajaDelimitadora, type CandidatoLugar, type FuenteCiudad, type FuenteLugares, type ZonaGeocodificada } from "./tipos";

// Doble de test: respuestas grabadas de verdad (fixtures/lugares/*.json,
// leídas por quien construye el fixture), indexadas por el texto exacto de
// la búsqueda. Ningún test de este bloque llama a Nominatim/Wikipedia de
// verdad (lug-ac1..lug-ac4): esta es la única "fuente" que usan.
export interface FixturesFuenteGrabada {
  destinos: Record<string, CajaDelimitadora | null>;
  nominatim: Record<string, CandidatoLugar[]>;
  wikipedia?: Record<string, CandidatoLugar[]>;
  // ciu-ac1/ciu-ac2: respuestas de las dos operaciones nuevas, indexadas
  // por el nombre exacto consultado (buscarLibre no lleva destino).
  libres?: Record<string, CandidatoLugar[]>;
  ciudades?: Record<string, CajaDelimitadora | null>;
  // ciu-ac7: nombres para los que la fuente debe lanzar FalloRedCiudad en
  // vez de devolver una respuesta -- simula el fallo de red persistente.
  // dmc-ac1: zonas geocodificadas por el texto exacto del destino; ausente
  // o sin entrada = Nominatim no conoce el texto.
  zonas?: Record<string, ZonaGeocodificada | null>;
  fallosZonas?: Set<string>;
  fallosLibres?: Set<string>;
  fallosCiudades?: Set<string>;
}

function claveBusqueda(nombre: string, destino: string): string {
  return `${nombre}::${destino}`;
}

// Acceso seguro a un diccionario de fixtures: un objeto plano normal
// resuelve claves como "toString" o "constructor" contra su prototipo en
// vez de devolver `undefined`, así que una parada con ese nombre literal
// recibiría una función en vez de una lista vacía. `Object.hasOwn` evita
// mirar el prototipo.
function buscarEnDiccionario<T>(diccionario: Record<string, T> | undefined, clave: string): T | undefined {
  if (!diccionario || !Object.hasOwn(diccionario, clave)) return undefined;
  return diccionario[clave];
}

export function crearFuenteLugaresGrabada(fixtures: FixturesFuenteGrabada): FuenteLugares & FuenteCiudad {
  return {
    async geocodificarDestino(destino: string): Promise<CajaDelimitadora | null> {
      return buscarEnDiccionario(fixtures.destinos, destino) ?? null;
    },
    async buscarNominatim(nombre: string, destino: string): Promise<CandidatoLugar[]> {
      return buscarEnDiccionario(fixtures.nominatim, claveBusqueda(nombre, destino)) ?? [];
    },
    async buscarWikipedia(nombre: string, destino: string): Promise<CandidatoLugar[]> {
      return buscarEnDiccionario(fixtures.wikipedia, claveBusqueda(nombre, destino)) ?? [];
    },
    async buscarLibre(nombre: string): Promise<CandidatoLugar[]> {
      if (fixtures.fallosLibres?.has(nombre)) throw new FalloRedCiudad(`fallo de red simulado para «${nombre}»`);
      return buscarEnDiccionario(fixtures.libres, nombre) ?? [];
    },
    async geocodificarZona(texto: string): Promise<ZonaGeocodificada | null> {
      if (fixtures.fallosZonas?.has(texto)) throw new FalloRedCiudad(`fallo de red simulado para «${texto}»`);
      return buscarEnDiccionario(fixtures.zonas, texto) ?? null;
    },
    async geocodificarCiudad(nombre: string): Promise<CajaDelimitadora | null> {
      if (fixtures.fallosCiudades?.has(nombre)) throw new FalloRedCiudad(`fallo de red simulado para «${nombre}»`);
      return buscarEnDiccionario(fixtures.ciudades, nombre) ?? null;
    },
  };
}
