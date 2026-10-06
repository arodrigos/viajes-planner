// guia-abierta: curiosidades = frases LITERALES del extracto de Wikipedia.
// Nada se reescribe ni se resume: lo que se enseña como «de Wikipedia» tiene
// que poder encontrarse tal cual en el artículo.
import { terminaEnAbreviaturaInterna, terminaEnInicial } from "./sanear";
import { MAX_TEXTO } from "./wikitexto";

const MAX_FRASES = 2;

// Palabras que abren frase en castellano e inglés. Tras una inicial o sigla
// («Jacobo I.», «D.C.») solo se corta si la siguiente es una de ellas: así
// «John F. Kennedy» y «U.S. President» siguen unidos. Es un Set y no una
// alternancia en una regex para no abrir un ReDoS.
export const ARRANQUES: ReadonlySet<string> = new Set(["The", "It", "In", "This", "These", "A", "An", "He", "She", "They", "His", "Her", "Its", "There", "After", "During", "Since", "Today", "However", "El", "La", "Los", "Las", "Un", "Una", "En", "Es", "Fue", "Se", "Su", "Sus", "Tras", "Durante", "Desde", "Hoy", "Este", "Esta", "Estos", "Estas", "Aunque", "Además", "Allí", "Hay"]);

const APERTURA_SEGMENTO = /^[«¿¡("“'‘]+/;
const PRIMERA_PALABRA = /^[^\s]+/;
const PUNTUACION_FINAL = /[.,;:!?»"”)]+$/;
const ABREVIATURA_ERA = /(?:^|\s)[ad]\.$/;
const INICIO_ERA = /^C\./;
const SIN_MARCADO = /[{}[\]<>]/;

// Para la huella de reglas (huella.ts).
export const REGEX_PARTIR: readonly RegExp[] = [APERTURA_SEGMENTO, PRIMERA_PALABRA, PUNTUACION_FINAL, ABREVIATURA_ERA, INICIO_ERA, SIN_MARCADO];

const abreFrase = (segmento: string) => ARRANQUES.has(PRIMERA_PALABRA.exec(segmento.replace(APERTURA_SEGMENTO, ""))?.[0].replace(PUNTUACION_FINAL, "") ?? "");

// Intl.Segmenter conoce el idioma pero no todas las abreviaturas («Bros.»,
// «Dr.»): sus segmentos se vuelven a unir con la lista propia de sanear.ts, y
// «a. C.» / «d. C.» también, para no dejar la «C.» huérfana al principio de
// la frase siguiente. Un «a. C.» al final de frase sigue cerrándola.
// Construir un Intl.Segmenter cuesta ~40 µs: un artículo largo lo pediría una
// vez por párrafo.
const segmentadores = new Map<string, Intl.Segmenter>();
function segmentadorDe(locale: string): Intl.Segmenter {
  let s = segmentadores.get(locale);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity: "sentence" });
    segmentadores.set(locale, s);
  }
  return s;
}

export function partirFrases(extracto: string, locale: string = "es"): string[] {
  const texto = extracto.replace(/\s+/g, " ").trim();
  if (texto.length === 0) return [];
  const segmentos = Array.from(segmentadorDe(locale).segment(texto), (s) => s.segment.trim()).filter((s) => s.length > 0);
  const frases: string[] = [];
  for (const segmento of segmentos) {
    const previa = frases[frases.length - 1];
    if (previa !== undefined && (terminaEnAbreviaturaInterna(previa) || (terminaEnInicial(previa) && !abreFrase(segmento)) || (ABREVIATURA_ERA.test(previa) && INICIO_ERA.test(segmento)))) frases[frases.length - 1] = `${previa} ${segmento}`;
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
  return candidatas.filter((f) => f.length >= 20 && f.length <= MAX_TEXTO && !SIN_MARCADO.test(f)).slice(0, MAX_FRASES);
}
