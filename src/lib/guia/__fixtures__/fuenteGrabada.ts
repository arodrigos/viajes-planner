// Fuente doblada con artículos y entidades grabados de las APIs reales
// (museos y monumentos públicos de Londres). Cuenta las peticiones.
import type { EntidadWikidata, FuenteCuriosidades, IdiomaCuriosidad, SitioCuriosidades } from "../candidatas";
import grabado from "./londres.json";
import type { Lugar } from "@/lib/plan/tipos";

const datos = grabado as unknown as {
  entidades: Record<string, EntidadWikidata>;
  articulos: Record<string, string>;
  entradillas: Record<string, string>;
};

export const ARTICULOS = datos.articulos;
export const ENTRADILLAS = datos.entradillas;
export const ENTIDADES = datos.entidades;

export function fuenteGrabada(): FuenteCuriosidades & { peticiones: { articulo: number; entradillas: number; entidades: number } } {
  const peticiones = { articulo: 0, entradillas: 0, entidades: 0 };
  return {
    peticiones,
    async entidades(qids) {
      peticiones.entidades += 1;
      return new Map(qids.filter((q) => datos.entidades[q]).map((q) => [q, datos.entidades[q]]));
    },
    async articulo(lang: IdiomaCuriosidad, titulo) {
      peticiones.articulo += 1;
      return datos.articulos[`${lang}:${titulo}`] ?? null;
    },
    async entradillas(lang: IdiomaCuriosidad, titulos) {
      peticiones.entradillas += 1;
      return new Map(titulos.filter((t) => datos.entradillas[`${lang}:${t}`]).map((t) => [t, datos.entradillas[`${lang}:${t}`]]));
    },
  };
}

function lugarConQid(nombre: string, qid: string | null): Lugar {
  return { fuente: "osm", id: `node/${nombre}`, url: "https://www.openstreetmap.org/node/1", nombre_fuente: nombre, etiquetas: qid ? { wikidata: qid } : {}, resuelto_en: "2026-10-05T10:00:00Z" } as unknown as Lugar;
}

export function sitiosLondres(): SitioCuriosidades[] {
  return [
    { id: "p-museo", tipo: "parada", nombre: "British Museum", lugar: lugarConQid("British Museum", "Q6373") },
    { id: "p-torre", tipo: "parada", nombre: "Tower of London", lugar: lugarConQid("Tower of London", "Q62378") },
    { id: "p-historia", tipo: "parada", nombre: "Natural History Museum", lugar: lugarConQid("Natural History Museum", "Q309388") },
    { id: "p-warner", tipo: "parada", nombre: "Warner Bros. Studio Tour London", lugar: lugarConQid("Warner", "Q27924395") },
    { id: "a-ciencia", tipo: "alternativa", nombre: "Science Museum", lugar: lugarConQid("Science Museum", "Q674773") },
    { id: "a-tate", tipo: "alternativa", nombre: "Tate Modern", lugar: lugarConQid("Tate Modern", "Q193375") },
  ];
}
