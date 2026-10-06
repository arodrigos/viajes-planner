// guia-abierta: curiosidades = frases LITERALES del extracto de Wikipedia.
// Nada se reescribe ni se resume: lo que se enseña como «de Wikipedia» tiene
// que poder encontrarse tal cual en el artículo.
import { terminaEnAbreviatura } from "./sanear";
import { MAX_TEXTO } from "./wikitexto";

const MAX_FRASES = 2;

// Intl.Segmenter conoce el idioma pero no todas las abreviaturas («Bros.»,
// «Dr.»): sus segmentos se vuelven a unir con la lista propia de sanear.ts, y
// «a. C.» / «d. C.» también, para no dejar la «C.» huérfana al principio de
// la frase siguiente. Un «a. C.» al final de frase sigue cerrándola.
export function partirFrases(extracto: string, locale: string = "es"): string[] {
  const texto = extracto.replace(/\s+/g, " ").trim();
  if (texto.length === 0) return [];
  const segmentos = Array.from(new Intl.Segmenter(locale, { granularity: "sentence" }).segment(texto), (s) => s.segment.trim()).filter((s) => s.length > 0);
  const frases: string[] = [];
  for (const segmento of segmentos) {
    const previa = frases[frases.length - 1];
    if (previa !== undefined && (terminaEnAbreviatura(previa) || (/(?:^|\s)[ad]\.$/.test(previa) && /^C\./.test(segmento)))) frases[frases.length - 1] = `${previa} ${segmento}`;
    else frases.push(segmento);
  }
  return frases;
}

// Con 3 o más frases se descarta la primera (suele ser la definición, que ya
// dice la descripción de la parada); con una sola no hay curiosidades.
export function extraerCuriosidades(extracto: string): string[] {
  const frases = partirFrases(extracto);
  if (frases.length < 2) return [];
  const candidatas = frases.length >= 3 ? frases.slice(1) : frases;
  return candidatas.filter((f) => f.length >= 20 && f.length <= MAX_TEXTO && !/[{}[\]<>]/.test(f)).slice(0, MAX_FRASES);
}
