import "server-only";
import type { CategoriaParada, Foto, Lugar, Parada, Plan } from "@/lib/plan/tipos";
import type { FuenteFotos } from "./tipos";

// fot-ac3: solo estas categorías ("de ver") aceptan foto por cercanía
// cuando el lugar resuelto no tiene artículo propio. Comida, compras,
// ocio-infantil, espectaculo y otro se quedan sin respaldo: una foto de
// "lo que hay al lado" de un restaurante no es una foto del restaurante.
const CATEGORIAS_DE_VER = new Set<CategoriaParada>([
  "monumento",
  "museo",
  "parque",
  "mirador",
  "plaza",
  "playa",
  "naturaleza",
  "barrio",
]);

// La etiqueta `wikipedia` de OSM viene como "lang:Título" (p. ej.
// "es:Museo del Prado"); el primer ":" separa idioma de título, el resto
// del título puede llevar ":" de sobra (poco común, pero no se descarta).
function paginaDesdeEtiquetaOsm(etiqueta: string): { lang: string; titulo: string } | null {
  const indice = etiqueta.indexOf(":");
  if (indice === -1) return null;
  const lang = etiqueta.slice(0, indice).trim();
  const titulo = etiqueta.slice(indice + 1).trim();
  if (!lang || !titulo) return null;
  return { lang, titulo };
}

// fot-ac3: la página "propia" de un lugar resuelto -nunca una de otro
// sitio-: o bien resolvió por Wikipedia (lugar.nombre_fuente ES el
// título), o bien trae la etiqueta `wikipedia` de OSM.
export function paginaPropiaDe(lugar: Lugar | undefined): { lang: string; titulo: string } | undefined {
  if (!lugar) return undefined;
  if (lugar.fuente === "wikipedia") return { lang: "es", titulo: lugar.nombre_fuente };
  if (lugar.etiquetas.wikipedia) return paginaDesdeEtiquetaOsm(lugar.etiquetas.wikipedia) ?? undefined;
  return undefined;
}

async function intentarPagina(fuente: FuenteFotos, lang: string, titulo: string): Promise<Foto | undefined> {
  const resumen = await fuente.resumenPagina(lang, titulo);
  if (!resumen?.fichero) return undefined;
  const foto = await fuente.infoImagen(resumen.fichero);
  return foto ?? undefined;
}

// fot-ac1/fot-ac3: nunca una foto de otro sitio -primero la página propia
// del lugar resuelto; solo si no hay o no tiene imagen aceptable, y solo
// para categorías "de ver", el respaldo por cercanía (geosearch <= 150 m).
export async function resolverFoto(
  fuente: FuenteFotos,
  lugar: Lugar | undefined,
  categoria: CategoriaParada | undefined,
  coordenadas: { lat: number; lon: number } | undefined,
): Promise<Foto | undefined> {
  const paginaPropia = paginaPropiaDe(lugar);
  if (paginaPropia) {
    const foto = await intentarPagina(fuente, paginaPropia.lang, paginaPropia.titulo);
    if (foto) return foto;
  }

  if (categoria && CATEGORIAS_DE_VER.has(categoria) && coordenadas) {
    const candidatas = await fuente.geosearch(coordenadas.lat, coordenadas.lon);
    for (const candidata of candidatas) {
      const foto = await intentarPagina(fuente, candidata.lang, candidata.titulo);
      if (foto) return foto;
    }
  }

  return undefined;
}

// fot-ac4: se llama solo sobre paradas YA resueltas (sin coordenadas no
// hay geosearch posible, y sin resolución no hay lugar propio que
// consultar); `foto_intentada_en` se guarda siempre, con éxito o sin él,
// para que el barrido sepa distinguir "pendiente" de "ya se intentó".
async function aplicarFotoAParada(fuente: FuenteFotos, parada: Parada): Promise<Parada> {
  if (!parada.coordenadas || parada.resolucion?.estado !== "resuelta") return parada;
  const foto = await resolverFoto(fuente, parada.lugar, parada.categoria, parada.coordenadas);
  return { ...parada, foto, foto_intentada_en: new Date().toISOString() };
}

export async function resolverFotosPlan(fuente: FuenteFotos, plan: Plan): Promise<Plan> {
  const dias = await Promise.all(
    plan.dias.map(async (dia) => ({
      ...dia,
      paradas: await Promise.all(dia.paradas.map((parada) => aplicarFotoAParada(fuente, parada))),
    })),
  );
  return { ...plan, dias };
}
