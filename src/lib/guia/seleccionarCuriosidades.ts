// curiosidades-verificadas: una sola invocación al modelo por versión. El
// modelo devuelve ids; el CÓDIGO copia el texto de la candidata, así que
// ningún texto del modelo llega nunca a la vista.
import { tmpdir } from "node:os";
import type { EjecutorModelo } from "@/lib/trabajador/ejecutorModelo";
import { MODELO_GENERACION } from "@/lib/trabajador/config";
import type { ItemCuriosidad } from "@/lib/plan/tipos";
import { puntuarFrase, type Candidata, type CandidatasSitio } from "./candidatas";
import { MAX_CANDIDATAS_PROMPT, MAX_ELEGIDAS_POR_SITIO, promptCuriosidades, type SitioEnPrompt } from "./promptCuriosidades";

export interface OpcionesSeleccion {
  directorio?: string;
  modelo?: string;
}

export interface SeleccionSitio {
  items: ItemCuriosidad[];
  // El modelo llegó a ver este sitio en una invocación que respondió bien.
  vistoPorModelo: boolean;
}

export interface ResultadoSeleccion {
  porSitio: Map<string, SeleccionSitio>;
  invocaciones: number;
  seleccion: "modelo" | "heuristica";
  error?: string;
}

const ID_CANDIDATA = /^c\d{1,3}$/;
const MAX_HEURISTICA = 4;
const FRASES_HEURISTICA = 3;

const clave = (texto: string) => texto.replace(/\s+/g, " ").trim().toLowerCase();

function aItem(c: Candidata, seleccion: ItemCuriosidad["seleccion"]): ItemCuriosidad {
  return { texto: c.texto, idioma: c.idioma, fuente: c.fuente, url: c.url, seleccion };
}

function sinRepetidos(items: ItemCuriosidad[]): ItemCuriosidad[] {
  const vistos = new Set<string>();
  return items.filter((i) => (vistos.has(clave(i.texto)) ? false : (vistos.add(clave(i.texto)), true))).slice(0, MAX_ELEGIDAS_POR_SITIO);
}

// Respaldo determinista: las 3 mejores frases por puntuación y 1 hecho de Wikidata.
export function elegirPorHeuristica(candidatas: Candidata[]): ItemCuriosidad[] {
  const frases = candidatas
    .filter((c) => c.fuente === "wikipedia")
    .map((c, orden) => ({ c, orden, p: puntuarFrase(c.texto) + (c.idioma === "es" ? 0.5 : 0) }))
    .sort((a, b) => b.p - a.p || a.orden - b.orden)
    .slice(0, FRASES_HEURISTICA)
    .map((e) => e.c);
  const hecho = candidatas.find((c) => c.fuente === "wikidata");
  return sinRepetidos([...frases, ...(hecho ? [hecho] : [])].map((c) => aItem(c, "heuristica"))).slice(0, MAX_HEURISTICA);
}

// Valida la salida del modelo sin fiarse de ella: solo cuentan los ids con la
// forma c<n> de claves conocidas y que existan en la lista de ESE sitio.
export function leerElecciones(texto: string, sitios: SitioEnPrompt[]): Map<string, string[]> | null {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const elecciones = new Map<string, string[]>();
  for (const { clave: k, datos } of sitios) {
    const valor = (bruto as Record<string, unknown>)[k];
    if (!Array.isArray(valor)) continue;
    const existentes = new Set(datos.candidatas.map((c) => c.id));
    const ids: string[] = [];
    for (const elemento of valor) {
      if (typeof elemento !== "string" || !ID_CANDIDATA.test(elemento) || !existentes.has(elemento) || ids.includes(elemento)) continue;
      ids.push(elemento);
      if (ids.length >= MAX_ELEGIDAS_POR_SITIO) break;
    }
    elecciones.set(k, ids);
  }
  return elecciones;
}

// Los sitios con candidatas caben en el prompt hasta MAX_CANDIDATAS_PROMPT;
// los que no caben van al respaldo, nunca a una segunda invocación.
export async function seleccionarCuriosidades(
  candidatas: CandidatasSitio[],
  ejecutor: EjecutorModelo,
  opciones: OpcionesSeleccion = {},
): Promise<ResultadoSeleccion> {
  const porSitio = new Map<string, SeleccionSitio>();
  const enPrompt: SitioEnPrompt[] = [];
  let total = 0;
  for (const datos of candidatas) {
    if (datos.candidatas.length === 0) {
      porSitio.set(datos.sitio.id, { items: [], vistoPorModelo: false });
      continue;
    }
    if (total + datos.candidatas.length > MAX_CANDIDATAS_PROMPT) {
      porSitio.set(datos.sitio.id, { items: elegirPorHeuristica(datos.candidatas), vistoPorModelo: false });
      continue;
    }
    total += datos.candidatas.length;
    enPrompt.push({ clave: `s${enPrompt.length + 1}`, datos });
  }
  if (enPrompt.length === 0) return { porSitio, invocaciones: 0, seleccion: "heuristica" };

  let elecciones: Map<string, string[]> | null = null;
  let error: string | undefined;
  try {
    const respuesta = await ejecutor.invocar(promptCuriosidades(enPrompt), { directorio: opciones.directorio ?? tmpdir(), modelo: opciones.modelo ?? MODELO_GENERACION });
    elecciones = leerElecciones(respuesta.texto, enPrompt);
    if (!elecciones) error = "respuesta del modelo no válida";
  } catch (e) {
    // El plan nunca falla por esto: límite de uso, error o JSON inválido
    // caen al respaldo.
    error = e instanceof Error ? e.message : "fallo del modelo";
  }

  let todosModelo = elecciones !== null;
  for (const { clave: k, datos } of enPrompt) {
    const ids = elecciones?.get(k) ?? [];
    const porId = new Map(datos.candidatas.map((c) => [c.id, c]));
    const delModelo = sinRepetidos(ids.map((id) => aItem(porId.get(id) as Candidata, "modelo")));
    if (delModelo.length > 0) {
      porSitio.set(datos.sitio.id, { items: delModelo, vistoPorModelo: true });
    } else {
      todosModelo = false;
      porSitio.set(datos.sitio.id, { items: elegirPorHeuristica(datos.candidatas), vistoPorModelo: elecciones !== null });
    }
  }
  return { porSitio, invocaciones: 1, seleccion: todosModelo ? "modelo" : "heuristica", ...(error ? { error } : {}) };
}
