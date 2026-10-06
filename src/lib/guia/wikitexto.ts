// guia-abierta: lector acotado del wikitexto de Wikivoyage. No es un
// analizador de MediaWiki: solo reconoce las plantillas de ficha y de ellas
// los parámetros que la tarjeta necesita. Todo lo demás se ignora, y el texto
// que sale es plano: nada de lo que viene de fuera llega a la vista con
// marcado.
export const MAX_TEXTO = 400;
// El consejo de la ficha se guarda casi entero; MAX_TEXTO sigue acotando las
// frases de curiosidades. El nombre tiene su propio tope.
export const MAX_CONSEJO = 2000;
export const MAX_NOMBRE = 120;

export type TipoFicha = "see" | "do" | "eat" | "drink";

export interface FichaGuia {
  tipo: TipoFicha;
  nombre: string;
  contenido: string;
  precio_texto?: string;
  precio_eur?: number;
  lat?: number;
  lon?: number;
}

// es.wikivoyage usa nombres de plantilla y de parámetro en castellano.
const PLANTILLA_A_TIPO: Record<string, TipoFicha | "generica"> = {
  see: "see",
  do: "do",
  eat: "eat",
  drink: "drink",
  listing: "generica",
  ver: "see",
  hacer: "do",
  comer: "eat",
  beber: "drink",
  listado: "generica",
};

const TIPO_POR_VALOR: Record<string, TipoFicha> = {
  see: "see",
  do: "do",
  eat: "eat",
  drink: "drink",
  ver: "see",
  hacer: "do",
  comer: "eat",
  beber: "drink",
};

const ALIAS: Record<string, string> = {
  nombre: "name",
  descripcion: "content",
  descripción: "content",
  precio: "price",
  latitud: "lat",
  longitud: "long",
  tipo: "type",
};

// Quita llaves, corchetes y etiquetas aunque vengan sin cerrar: la garantía
// «texto sin marcado» no puede depender de que el wikitexto esté bien formado.
export function limpiarTexto(entrada: string, max: number = MAX_TEXTO): string {
  let t = entrada;
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{[^{}]*\}\}/g, " ");
  t = t
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\[(?:https?:)?\/\/\S+\]/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[{}[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return `${(ultimoEspacio > max / 2 ? corte.slice(0, ultimoEspacio) : corte).trimEnd()}…`;
}

// Por encima de MAX_CONSEJO corta en el último fin de frase para que la
// tarjeta no enseñe una frase a medias; solo si no hay ninguno razonable
// cae al corte por palabra de limpiarTexto.
export function limpiarConsejo(entrada: string): string {
  const completo = limpiarTexto(entrada, Number.MAX_SAFE_INTEGER);
  if (completo.length <= MAX_CONSEJO) return completo;
  const ventana = completo.slice(0, MAX_CONSEJO - 1);
  let corte = -1;
  for (const m of ventana.matchAll(/[.!?](?=\s|$)/g)) corte = m.index;
  // En la ventana, un «.» final puede ser el principio de una frase cortada
  // justo ahí: solo vale si lo que sigue en el texto original es un espacio.
  if (corte >= MAX_CONSEJO / 4 && /\s/.test(completo[corte + 1] ?? " ")) return `${ventana.slice(0, corte + 1)}…`;
  return limpiarTexto(completo, MAX_CONSEJO);
}

// Un precio solo se suma si es un importe claro. «Adult €13.50, concessions
// €6» da 13,5 (el primero es el de adulto); «free on Sundays» no es un
// importe y se enseña literal.
export function parsearPrecioEur(texto: string): number | undefined {
  const t = texto.trim();
  if (/^(free|gratis|gratuito|entrada libre|libre)\W*$/i.test(t)) return 0;
  const antes = t.match(/€\s?(\d{1,4}(?:[.,]\d{1,2})?)/);
  const despues = t.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|eur\b)/i);
  const crudo = antes?.[1] ?? despues?.[1];
  if (!crudo) return undefined;
  const valor = Number(crudo.replace(",", "."));
  return Number.isFinite(valor) && valor >= 0 && valor <= 2000 ? valor : undefined;
}

// Recorre el texto contando llaves: las plantillas anidadas ({{flag|..}}
// dentro de content) no cortan la ficha antes de tiempo.
function plantillasDeNivelSuperior(texto: string): string[] {
  const resultado: string[] = [];
  let i = 0;
  while (i < texto.length - 1) {
    if (texto[i] === "{" && texto[i + 1] === "{") {
      let profundidad = 0;
      let j = i;
      while (j < texto.length - 1) {
        if (texto[j] === "{" && texto[j + 1] === "{") {
          profundidad++;
          j += 2;
        } else if (texto[j] === "}" && texto[j + 1] === "}") {
          profundidad--;
          j += 2;
          if (profundidad === 0) break;
        } else j++;
      }
      if (profundidad === 0) resultado.push(texto.slice(i, j));
      i = j;
    } else i++;
  }
  return resultado;
}

// Separa por «|» solo en el nivel superior: dentro de [[a|b]] o {{x|y}} el
// separador pertenece al enlace o a la plantilla anidada.
function partirParametros(cuerpo: string): string[] {
  const partes: string[] = [];
  let actual = "";
  let llaves = 0;
  let corchetes = 0;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    const siguiente = cuerpo[i + 1];
    if (c === "{" && siguiente === "{") {
      llaves++;
      actual += "{{";
      i++;
    } else if (c === "}" && siguiente === "}") {
      llaves--;
      actual += "}}";
      i++;
    } else if (c === "[" && siguiente === "[") {
      corchetes++;
      actual += "[[";
      i++;
    } else if (c === "]" && siguiente === "]") {
      corchetes--;
      actual += "]]";
      i++;
    } else if (c === "|" && llaves === 0 && corchetes === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  partes.push(actual);
  return partes;
}

function numero(valor: string | undefined): number | undefined {
  if (!valor) return undefined;
  const n = Number(valor.trim().replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export function extraerFichas(wikitexto: string): FichaGuia[] {
  const fichas: FichaGuia[] = [];
  for (const plantilla of plantillasDeNivelSuperior(wikitexto)) {
    const interior = plantilla.slice(2, -2);
    const [cabecera, ...resto] = partirParametros(interior);
    const nombrePlantilla = cabecera.trim().toLowerCase();
    const base = PLANTILLA_A_TIPO[nombrePlantilla];
    if (!base) continue;

    const parametros = new Map<string, string>();
    for (const parte of resto) {
      const igual = parte.indexOf("=");
      if (igual === -1) continue;
      const clave = parte.slice(0, igual).trim().toLowerCase();
      parametros.set(ALIAS[clave] ?? clave, parte.slice(igual + 1).trim());
    }

    const tipo = base === "generica" ? TIPO_POR_VALOR[(parametros.get("type") ?? "").toLowerCase()] : base;
    if (!tipo) continue;
    const nombre = limpiarTexto(parametros.get("name") ?? "", MAX_NOMBRE);
    const contenido = limpiarConsejo(parametros.get("content") ?? "");
    if (!nombre || !contenido) continue;

    const precioCrudo = limpiarTexto(parametros.get("price") ?? "", 120);
    const lat = numero(parametros.get("lat"));
    const lon = numero(parametros.get("long"));
    fichas.push({
      tipo,
      nombre,
      contenido,
      ...(precioCrudo ? { precio_texto: precioCrudo } : {}),
      ...(precioCrudo && parsearPrecioEur(precioCrudo) !== undefined ? { precio_eur: parsearPrecioEur(precioCrudo) } : {}),
      ...(lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : {}),
    });
  }
  return fichas;
}
