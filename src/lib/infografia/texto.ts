// lam-ac1: todo texto que llega a la lámina pasa por aquí. Los nombres vienen
// de fuentes externas y del modelo: pueden traer dobles espacios, NBSP,
// caracteres de control o marcadores bidi que satori dibuja como huecos o
// invierte el orden de lo que hay detrás.

// U+202A–U+202E y U+2066–U+2069: marcadores bidi. Controles C0 y C1.
const INVISIBLES = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

const SEGMENTADOR = new Intl.Segmenter("es", { granularity: "grapheme" });

export function limpiarTexto(texto: string): string {
  // Los espacios (incluido NBSP) se unifican antes de quitar los controles:
  // así tabuladores y saltos de línea separan palabras en vez de pegarlas.
  return texto
    .replace(/\s+/g, " ")
    .replace(INVISIBLES, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

// Se corta por grafemas, no por unidades UTF-16: un emoji compuesto o una
// letra con diacrítico combinante no se parte por la mitad.
export function recortar(texto: string, max: number): string {
  const limpio = limpiarTexto(texto);
  const grafemas = Array.from(SEGMENTADOR.segment(limpio), (s) => s.segment);
  if (grafemas.length <= max) return limpio;
  return `${grafemas.slice(0, max - 1).join("").trimEnd()}…`;
}
