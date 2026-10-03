import type { CajaDelimitadora, CandidatoLugar, FuenteLugares } from "./tipos";

// Doble de test: respuestas grabadas de verdad (fixtures/lugares/*.json,
// leídas por quien construye el fixture), indexadas por el texto exacto de
// la búsqueda. Ningún test de este bloque llama a Nominatim/Wikipedia de
// verdad (lug-ac1..lug-ac4): esta es la única "fuente" que usan.
export interface FixturesFuenteGrabada {
  destinos: Record<string, CajaDelimitadora | null>;
  nominatim: Record<string, CandidatoLugar[]>;
  wikipedia?: Record<string, CandidatoLugar[]>;
}

function claveBusqueda(nombre: string, destino: string): string {
  return `${nombre}::${destino}`;
}

export function crearFuenteLugaresGrabada(fixtures: FixturesFuenteGrabada): FuenteLugares {
  return {
    async geocodificarDestino(destino: string): Promise<CajaDelimitadora | null> {
      return fixtures.destinos[destino] ?? null;
    },
    async buscarNominatim(nombre: string, destino: string): Promise<CandidatoLugar[]> {
      return fixtures.nominatim[claveBusqueda(nombre, destino)] ?? [];
    },
    async buscarWikipedia(nombre: string, destino: string): Promise<CandidatoLugar[]> {
      return fixtures.wikipedia?.[claveBusqueda(nombre, destino)] ?? [];
    },
  };
}
