// guia-abierta: lo que sale de la base de datos hacia un href se vuelve a
// comprobar al leerlo. El trabajador ya solo escribe URLs canónicas, pero un
// dato manipulado en la tabla no debe acabar en un enlace de la vista.
import type { CuriosidadesParada, GuiaParada, ItemCuriosidad } from "@/lib/plan/tipos";
import { sanearFrases, sanearItems } from "./sanear";
import { MAX_CONSEJO, MAX_TEXTO } from "./wikitexto";

function esHttpsDe(url: unknown, sufijo: string): url is string {
  if (typeof url !== "string") return false;
  try {
    const analizada = new URL(url);
    return (
      analizada.protocol === "https:" &&
      analizada.username === "" &&
      analizada.password === "" &&
      (analizada.hostname === sufijo || analizada.hostname.endsWith(`.${sufijo}`))
    );
  } catch {
    return false;
  }
}

export const esUrlWikivoyage = (url: unknown): url is string => esHttpsDe(url, "wikivoyage.org");
export const esUrlWikidata = (url: unknown): url is string => typeof url === "string" && /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(url);
export const esUrlWikipedia = (url: unknown): url is string => esHttpsDe(url, "wikipedia.org");

const SIN_MARCADO = /[{}[\]<>]/;

export function guiaSegura(guia: GuiaParada | null | undefined): GuiaParada | undefined {
  if (!guia || typeof guia.consejo !== "string") return undefined;
  if (guia.consejo.length === 0 || guia.consejo.length > MAX_CONSEJO || SIN_MARCADO.test(guia.consejo)) return undefined;
  if (!esUrlWikivoyage(guia.url) || guia.licencia !== "CC BY-SA") return undefined;
  return guia;
}

function itemSeguro(item: unknown): item is ItemCuriosidad {
  if (typeof item !== "object" || item === null) return false;
  const i = item as Record<string, unknown>;
  if (typeof i.texto !== "string" || i.texto.length === 0 || i.texto.length > MAX_TEXTO || SIN_MARCADO.test(i.texto)) return false;
  if (i.idioma !== "es" && i.idioma !== "en") return false;
  if (i.seleccion !== "modelo" && i.seleccion !== "heuristica") return false;
  if (i.fuente === "wikipedia") return esUrlWikipedia(i.url);
  return i.fuente === "wikidata" && esUrlWikidata(i.url);
}

// Devuelve la versión saneada, no la original: un item manipulado en la tabla
// se descarta sin tirar el resto, y el formato anterior ({frases, url}) sigue
// pintándose como hasta ahora.
export function curiosidadesSeguras(c: CuriosidadesParada | null | undefined): CuriosidadesParada | undefined {
  if (!c || !Array.isArray(c.frases)) return undefined;
  const items = Array.isArray(c.items) ? sanearItems(c.items.filter(itemSeguro), c.formato ?? 0).slice(0, 4) : [];
  const urlValida = esUrlWikipedia(c.url);
  const frases = urlValida ? sanearFrases(c.frases.filter((f) => typeof f === "string" && f.length > 0 && f.length <= MAX_TEXTO && !SIN_MARCADO.test(f)), c.formato ?? 0) : [];
  if (items.length === 0 && frases.length === 0) return undefined;
  return {
    frases,
    url: urlValida ? c.url : "",
    ...(items.length > 0 ? { items } : {}),
    // Sin la marca, guardar lo que se acaba de leer (sustituir una parada)
    // dejaba las curiosidades como «anteriores» y el trabajador las reprocesaba.
    ...(typeof c.formato === "number" ? { formato: c.formato } : {}),
    ...(c.seleccion === "modelo" || c.seleccion === "heuristica" ? { seleccion: c.seleccion } : {}),
    ...(c.mejora_intentada === true ? { mejora_intentada: true } : {}),
  };
}
