import type { Foto } from "@/lib/plan/tipos";
import type { CandidatoGeosearch, FuenteFotos, ResumenPaginaWikipedia } from "./tipos";

// Doble de test: respuestas grabadas de verdad (fixtures/fotos/*.json),
// indexadas por clave exacta. Ningún test del bloque fotos-paradas llama a
// Wikipedia/Commons de verdad -- esta es la única "fuente" que usan.
export interface FixturesFuenteFotosGrabada {
  paginas: Record<string, ResumenPaginaWikipedia | null>; // clave: "lang:titulo"
  imagenes: Record<string, Foto | null>; // clave: nombre de fichero
  geosearch?: Record<string, CandidatoGeosearch[]>; // clave: "lat,lon"
}

function clavePagina(lang: string, titulo: string): string {
  return `${lang}:${titulo}`;
}

export function crearFuenteFotosGrabada(fixtures: FixturesFuenteFotosGrabada): FuenteFotos {
  return {
    async resumenPagina(lang: string, titulo: string): Promise<ResumenPaginaWikipedia | null> {
      return fixtures.paginas[clavePagina(lang, titulo)] ?? null;
    },
    async infoImagen(fichero: string): Promise<Foto | null> {
      return fixtures.imagenes[fichero] ?? null;
    },
    async geosearch(lat: number, lon: number): Promise<CandidatoGeosearch[]> {
      return fixtures.geosearch?.[`${lat},${lon}`] ?? [];
    },
  };
}
