// curiosidades-verificadas: el modelo nunca escribe ni traduce una curiosidad,
// solo ELIGE entre las candidatas que arma este módulo. Cada candidata es una
// frase literal de un artículo de Wikipedia (en su idioma) o un hecho de
// Wikidata con plantilla fija escrita aquí, así que lo que se enseña se puede
// comprobar contra la fuente descargada.
import type { Lugar } from "@/lib/plan/tipos";
import { paginaPropiaDe } from "@/lib/lugares/resolverFotos";
import { formatearAnio, formatearNumero } from "@/lib/formato/numeros";
import { partirFrases } from "./curiosidades";

export type IdiomaCuriosidad = "es" | "en";
export type PropiedadWikidata = "P571" | "P1619" | "P84" | "P2048" | "P1435" | "P1174";

export const MAX_FRASE = 300;
export const MIN_FRASE = 20;
// Techos por sitio: una parada usa el artículo completo, una alternativa solo
// la entradilla.
export const MAX_HECHOS_PARADA = 3;
export const MAX_ES_PARADA = 5;
export const MAX_CANDIDATAS_PARADA = 12;
export const MAX_HECHOS_ALTERNATIVA = 2;
export const MAX_POR_IDIOMA_ALTERNATIVA = 2;

// Un hecho tal cual sale de la entidad, sin redactar: la plantilla se aplica
// en textoDeHecho.
export interface HechoWikidata {
  propiedad: PropiedadWikidata;
  anio?: number;
  numero?: number;
  etiquetas?: string[];
  // Año de la medida (P585) de los visitantes anuales.
  anioMedida?: number;
}

export interface EntidadWikidata {
  qid: string;
  // QIDs de «instancia de» (P31): deciden si una fecha de fundación es la de
  // una institución.
  clases?: string[];
  titulos: { es?: string; en?: string };
  hechos: HechoWikidata[];
}

export interface FuenteCuriosidades {
  entidades(qids: string[]): Promise<Map<string, EntidadWikidata>>;
  // Texto plano del artículo completo; null si la página no existe.
  articulo(lang: IdiomaCuriosidad, titulo: string): Promise<string | null>;
  // Solo la entradilla, en lote; las páginas que no existen no aparecen.
  entradillas(lang: IdiomaCuriosidad, titulos: string[]): Promise<Map<string, string>>;
}

export interface SitioCuriosidades {
  // Identificador interno del sitio: nunca viaja al modelo.
  id: string;
  tipo: "parada" | "alternativa";
  nombre: string;
  lugar?: Lugar | null;
}

export interface Candidata {
  id: string;
  texto: string;
  fuente: "wikipedia" | "wikidata";
  idioma: IdiomaCuriosidad;
  url: string;
}

export interface CandidatasSitio {
  sitio: SitioCuriosidades;
  candidatas: Candidata[];
}

const SIN_MARCADO = /[{}[\]<>]/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Restos de referencias y enlaces que no son un dato curioso.
const RUIDO = /Archivado el|Wayback|Consultado el|Retrieved|Archived|ISBN|Véase también/i;

const normalizar = (t: string) => t.replace(/\s+/g, " ").trim();

// Pesa lo que suele ser un dato curioso: cifras, años y superlativos.
export function puntuarFrase(frase: string): number {
  let puntos = 0;
  if (/\d/.test(frase)) puntos += 2;
  if (/\b(1[0-9]{3}|20[0-2][0-9])\b/.test(frase)) puntos += 2;
  if (/\b(primer[oa]?|más|único|única|mayor|mejor|first|oldest|largest|biggest|most|only|world)\b/i.test(frase)) puntos += 2;
  if (frase.length >= 60 && frase.length <= 220) puntos += 1;
  return puntos;
}

export function frasesDeTexto(texto: string, locale: string = "es"): string[] {
  const parrafos = texto
    .split(/\n+/)
    .map(normalizar)
    .filter((p) => p.length > 0 && !/^=+.*=+$/.test(p));
  const vistas = new Set<string>();
  const frases: string[] = [];
  parrafos.forEach((parrafo, indice) => {
    // La primera frase del artículo es la definición: la parada ya tiene su
    // descripción y no es una curiosidad.
    const partidas = partirFrases(parrafo, locale).slice(indice === 0 ? 1 : 0);
    for (const f of partidas) {
      if (f.length < MIN_FRASE || f.length > MAX_FRASE) continue;
      if (SIN_MARCADO.test(f) || f.includes("@") || UUID.test(f) || /==/.test(f) || RUIDO.test(f)) continue;
      if (!/[.!?»"”)]$/.test(f)) continue;
      if (vistas.has(f)) continue;
      vistas.add(f);
      frases.push(f);
    }
  });
  return frases;
}

function mejores(frases: string[], max: number): string[] {
  const elegidas = frases
    .map((f, orden) => ({ f, orden, p: puntuarFrase(f) }))
    .sort((a, b) => b.p - a.p || a.orden - b.orden)
    .slice(0, max);
  return elegidas.sort((a, b) => a.orden - b.orden).map((e) => e.f);
}

const codificar = (t: string) => encodeURIComponent(t).replace(/-/g, "%2D");

export function urlPaginaWikipedia(lang: IdiomaCuriosidad, titulo: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titulo.replace(/ /g, "_"))}`;
}

// URL Text Fragment: salta a la frase exacta y la resalta. Con frases largas
// solo van sus primeras y últimas palabras (rango), que el navegador completa.
export function urlConFragmento(base: string, frase: string): string {
  const palabras = frase.split(" ");
  if (palabras.length <= 8) return `${base}#:~:text=${codificar(frase)}`;
  return `${base}#:~:text=${codificar(palabras.slice(0, 4).join(" "))},${codificar(palabras.slice(-4).join(" "))}`;
}

// museo, museo de arte, galería de arte, biblioteca, universidad y zoo.
const CLASES_INSTITUCION: ReadonlySet<string> = new Set(["Q33506", "Q207694", "Q1007870", "Q7075", "Q3918", "Q43501"]);

const unir = (etiquetas: string[]) => (etiquetas.length > 1 ? `${etiquetas.slice(0, -1).join(", ")} y ${etiquetas[etiquetas.length - 1]}` : (etiquetas[0] ?? ""));

// Plantillas fijas en castellano: ningún texto de la fuente se cuela salvo el
// valor (año, número o etiqueta) del hecho.
export function textoDeHecho(h: HechoWikidata, clases: readonly string[] = []): string | null {
  switch (h.propiedad) {
    case "P571":
      if (h.anio === undefined) return null;
      // En un museo o una universidad P571 es cuándo nació la entidad, no el
      // edificio que se visita: se dice así para no confundir.
      return clases.some((c) => CLASES_INSTITUCION.has(c)) ? `La institución se fundó en ${formatearAnio(h.anio)}.` : `Se fundó en ${formatearAnio(h.anio)}.`;
    case "P1619":
      return h.anio !== undefined ? `Se inauguró en ${formatearAnio(h.anio)}.` : null;
    case "P84":
      return h.etiquetas?.length ? `Lo diseñó ${unir(h.etiquetas.slice(0, 2))}.` : null;
    case "P2048":
      return h.numero !== undefined && h.numero > 0 ? `Mide ${formatearNumero(h.numero)} m de altura.` : null;
    case "P1435":
      return h.etiquetas?.length ? `Está protegido como ${h.etiquetas[0]}.` : null;
    case "P1174":
      return h.numero !== undefined && h.numero > 0
        ? `Recibe unos ${formatearNumero(h.numero)} visitantes al año${h.anioMedida !== undefined ? ` (${formatearAnio(h.anioMedida)})` : ""}.`
        : null;
  }
}

function candidatasDeHechos(entidad: EntidadWikidata | undefined, max: number): Array<Omit<Candidata, "id">> {
  if (!entidad) return [];
  const url = `https://www.wikidata.org/wiki/${entidad.qid}`;
  const vistos = new Set<string>();
  const salida: Array<Omit<Candidata, "id">> = [];
  // Con fecha de apertura, la de fundación de la entidad sobra.
  const hayApertura = entidad.hechos.some((h) => h.propiedad === "P1619" && h.anio !== undefined);
  for (const hecho of entidad.hechos) {
    if (hayApertura && hecho.propiedad === "P571") continue;
    const texto = textoDeHecho(hecho, entidad.clases);
    if (!texto || SIN_MARCADO.test(texto) || texto.includes("@") || vistos.has(texto)) continue;
    vistos.add(texto);
    salida.push({ texto, fuente: "wikidata", idioma: "es", url });
    if (salida.length >= max) break;
  }
  return salida;
}

const QID = /^Q\d{1,12}$/;

function paginasDe(sitio: SitioCuriosidades, entidad: EntidadWikidata | undefined): Partial<Record<IdiomaCuriosidad, string>> {
  const paginas: Partial<Record<IdiomaCuriosidad, string>> = { ...(entidad?.titulos ?? {}) };
  const propia = paginaPropiaDe(sitio.lugar ?? undefined);
  if (propia && (propia.lang === "es" || propia.lang === "en") && !paginas[propia.lang]) paginas[propia.lang] = propia.titulo;
  return paginas;
}

function qidDe(sitio: SitioCuriosidades): string | undefined {
  const qid = sitio.lugar?.etiquetas.wikidata;
  return qid && QID.test(qid) ? qid : undefined;
}

// Construye las candidatas numeradas (c1, c2…) de cada sitio. Una fuente que
// falla lanza: el sitio se pospone entero, no se rellena a medias.
export async function construirCandidatas(sitios: SitioCuriosidades[], fuente: FuenteCuriosidades): Promise<CandidatasSitio[]> {
  const qids = [...new Set(sitios.map(qidDe).filter((q): q is string => Boolean(q)))];
  const entidades = qids.length > 0 ? await fuente.entidades(qids) : new Map<string, EntidadWikidata>();

  const paginas = new Map<string, Partial<Record<IdiomaCuriosidad, string>>>();
  for (const sitio of sitios) {
    const qid = qidDe(sitio);
    paginas.set(sitio.id, paginasDe(sitio, qid ? entidades.get(qid) : undefined));
  }

  // Alternativas: entradillas de todas en un lote por idioma.
  const entradillas: Record<IdiomaCuriosidad, Map<string, string>> = { es: new Map(), en: new Map() };
  for (const lang of ["es", "en"] as const) {
    const titulos = [...new Set(sitios.filter((s) => s.tipo === "alternativa").map((s) => paginas.get(s.id)?.[lang]).filter((t): t is string => Boolean(t)))];
    for (let i = 0; i < titulos.length; i += 20) {
      const lote = await fuente.entradillas(lang, titulos.slice(i, i + 20));
      for (const [titulo, texto] of lote) entradillas[lang].set(titulo, texto);
    }
  }

  const resultado: CandidatasSitio[] = [];
  for (const sitio of sitios) {
    const qid = qidDe(sitio);
    const entidad = qid ? entidades.get(qid) : undefined;
    const titulos = paginas.get(sitio.id) ?? {};
    const sinId: Array<Omit<Candidata, "id">> = [];

    const deWikipedia = async (lang: IdiomaCuriosidad, max: number): Promise<Array<Omit<Candidata, "id">>> => {
      const titulo = titulos[lang];
      if (!titulo) return [];
      const texto = sitio.tipo === "parada" ? await fuente.articulo(lang, titulo) : (entradillas[lang].get(titulo) ?? null);
      if (!texto) return [];
      const compacto = normalizar(texto);
      // Cada frase tiene que aparecer tal cual en el artículo: es lo que
      // permite rotularla «de Wikipedia».
      const frases = mejores(frasesDeTexto(texto).filter((f) => compacto.includes(f)), max);
      const base = urlPaginaWikipedia(lang, titulo);
      return frases.map((f) => ({ texto: f, fuente: "wikipedia" as const, idioma: lang, url: urlConFragmento(base, f) }));
    };

    if (sitio.tipo === "parada") {
      const hechos = candidatasDeHechos(entidad, MAX_HECHOS_PARADA);
      const es = await deWikipedia("es", MAX_ES_PARADA);
      const en = await deWikipedia("en", MAX_CANDIDATAS_PARADA);
      sinId.push(...hechos, ...es, ...en.slice(0, Math.max(0, MAX_CANDIDATAS_PARADA - hechos.length - es.length)));
    } else {
      sinId.push(
        ...candidatasDeHechos(entidad, MAX_HECHOS_ALTERNATIVA),
        ...(await deWikipedia("es", MAX_POR_IDIOMA_ALTERNATIVA)),
        ...(await deWikipedia("en", MAX_POR_IDIOMA_ALTERNATIVA)),
      );
    }
    resultado.push({ sitio, candidatas: sinId.map((c, i) => ({ id: `c${i + 1}`, ...c })) });
  }
  return resultado;
}
