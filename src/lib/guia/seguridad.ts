// guia-abierta: lo que sale de la base de datos hacia un href se vuelve a
// comprobar al leerlo. El trabajador ya solo escribe URLs canónicas, pero un
// dato manipulado en la tabla no debe acabar en un enlace de la vista.
import type { CuriosidadesParada, GuiaParada } from "@/lib/plan/tipos";
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
export const esUrlWikipedia = (url: unknown): url is string => esHttpsDe(url, "wikipedia.org");

const SIN_MARCADO = /[{}[\]<>]/;

export function guiaSegura(guia: GuiaParada | null | undefined): GuiaParada | undefined {
  if (!guia || typeof guia.consejo !== "string") return undefined;
  if (guia.consejo.length === 0 || guia.consejo.length > MAX_CONSEJO || SIN_MARCADO.test(guia.consejo)) return undefined;
  if (!esUrlWikivoyage(guia.url) || guia.licencia !== "CC BY-SA") return undefined;
  return guia;
}

export function curiosidadesSeguras(c: CuriosidadesParada | null | undefined): CuriosidadesParada | undefined {
  if (!c || !Array.isArray(c.frases) || !esUrlWikipedia(c.url)) return undefined;
  const frases = c.frases.filter((f) => typeof f === "string" && f.length > 0 && f.length <= MAX_TEXTO && !SIN_MARCADO.test(f));
  return frases.length > 0 ? { frases, url: c.url } : undefined;
}
