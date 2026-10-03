// lug-ac2: comparar nombres propuestos por el modelo contra resultados de
// Nominatim/Wikipedia necesita ignorar diacríticos, artículos y mayúsculas
// -- "Museo del Prado" y "Museo Nacional del Prado" son el mismo sitio-- y
// medir similitud con un método determinista y testeable (coeficiente de
// Dice sobre bigramas de caracteres), no con una llamada al modelo.

const ARTICULOS = new Set(["el", "la", "los", "las", "de", "del", "un", "una", "y"]);

export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0 && !ARTICULOS.has(palabra))
    .join(" ")
    .trim();
}

function bigramas(texto: string): string[] {
  const compacto = texto.replace(/\s+/g, "");
  const resultado: string[] = [];
  for (let i = 0; i < compacto.length - 1; i++) resultado.push(compacto.slice(i, i + 2));
  return resultado;
}

// Coeficiente de Dice: 2 * |bigramas comunes| / (|bigramas A| + |bigramas B|).
// Cadenas idénticas de 0-1 caracteres (sin bigramas) se consideran
// similares si son iguales, 0 si no -- evita una división por cero.
export function similitudDice(a: string, b: string): number {
  const bigramasA = bigramas(a);
  const bigramasB = bigramas(b);
  if (bigramasA.length === 0 || bigramasB.length === 0) {
    return a === b ? 1 : 0;
  }
  const bolsaB = [...bigramasB];
  let comunes = 0;
  for (const bigrama of bigramasA) {
    const indice = bolsaB.indexOf(bigrama);
    if (indice !== -1) {
      comunes++;
      bolsaB.splice(indice, 1);
    }
  }
  return (2 * comunes) / (bigramasA.length + bigramasB.length);
}

// Mejor similitud del nombre buscado contra el nombre principal y
// cualquier nombre alternativo (namedetails de Nominatim, variantes
// idiomáticas de Wikipedia): basta que UNA variante encaje.
export function mejorSimilitud(nombreBuscado: string, candidatos: string[]): number {
  const normalizado = normalizarNombre(nombreBuscado);
  return candidatos.reduce((mejor, candidato) => Math.max(mejor, similitudDice(normalizado, normalizarNombre(candidato))), 0);
}
