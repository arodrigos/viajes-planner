// Saneado de curiosidades ya elegidas. Es una función pura y sin dependencias
// de servidor porque corre en dos sitios: al leer (así lo que ya está guardado
// sale limpio sin tocar la base) y en el trabajador, antes de guardar.
import type { ItemCuriosidad } from "@/lib/plan/tipos";

// Caracteres de formato de anchura cero (U+200B-U+200F, marcas y aislantes
// bidi, U+2060-U+2064, U+206A-U+206F, U+00AD, U+034F, U+061C, U+180E, U+FEFF) y
// los rellenos hangul que se pintan en blanco (U+115F, U+1160, U+3164, U+FFA0):
// no se ven, pero rompen la búsqueda de la frase en el artículo y dejan
// huecos al partir líneas. Wikipedia mete U+200E/U+200F con frecuencia.
const INVISIBLES = /[\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0]/g;
// Controles C0 y C1 salvo los espacios en blanco, que se normalizan después.
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

// Abreviaturas que NUNCA cierran una frase: lo que sigue es su continuación
// («Warner Bros. Studio Tour», «Mt. Vernon», «s. XVI»). «a. C.» o «etc.» sí pueden cerrarla, así que
// no figuran aquí.
export const ABREVIATURAS_INTERNAS = ["Bros", "St", "Dr", "Dra", "Sr", "Sra", "Srta", "Mr", "Mrs", "Ms", "Jr", "Co", "Inc", "Ltd", "Av", "Avda", "Prof", "Gral", "Sto", "Sta", "Gen", "Mt", "Mte", "Pza", "Pl", "Ctra", "Cmdr", "Col", "Capt", "Lt", "Sgt", "Rev", "Gov", "Sen", "Hon", "Fr", "Mons", "Lic", "Ing", "Arq", "Ud", "Uds", "Vd", "Mme", "Mlle", "Ste", "Cía", "Pte", "núm", "vol", "cap", "pág", "s", "No", "vs", "Hnos", "approx"];

const INICIO = "(?:^|[\\s(«\"“'‘])";
const TERMINA_EN_ABREVIATURA = new RegExp(`${INICIO}(?:${ABREVIATURAS_INTERNAS.join("|")})\\.$`);
// Regla general además de la lista: una inicial suelta («John F.», «Washington D.»)
// o una sigla con puntos («U.S.») nunca cierran frase en un texto enciclopédico.
// «a. C.» / «d. C.» / «D. C.» quedan fuera: sí pueden acabar una frase.
const TERMINA_EN_INICIAL = new RegExp(`${INICIO}(?<![adAD]\\. )\\p{Lu}\\.$|${INICIO}(?:\\p{Lu}\\.){2,}$`, "u");

// Formato de curiosidades desde el que una frase que acaba en inicial o sigla
// se considera completa: se escribió con la regla de ARRANQUES, que solo corta
// ahí si lo siguiente abre frase.
export const FORMATO_SIGLA_FINAL = 5;

export function terminaEnAbreviaturaInterna(frase: string): boolean {
  return TERMINA_EN_ABREVIATURA.test(frase.trimEnd());
}

export function terminaEnInicial(frase: string): boolean {
  return TERMINA_EN_INICIAL.test(frase.trimEnd());
}

export function terminaEnAbreviatura(frase: string): boolean {
  return terminaEnAbreviaturaInterna(frase) || terminaEnInicial(frase);
}

// Una frase que empieza en minúscula (tras signos de apertura) es la segunda
// mitad de otra cortada por un salto de línea o por una abreviatura: al leer
// no se tiene la frase previa, así que se descarta aunque alguna fuera legítima
// («iPhone…»): perder una curiosidad es mejor que pintar una rota.
export const APERTURA_FRASE = /^[«¿¡("“'‘]+/;
export function empiezaEnMinuscula(texto: string): boolean {
  return /^\p{Ll}/u.test(texto.trimStart().replace(APERTURA_FRASE, ""));
}

// Una abreviatura de la lista nunca cierra frase; una inicial o sigla solo la
// cierra en lo guardado con la regla nueva.
function cortada(texto: string, formato: number): boolean {
  return terminaEnAbreviaturaInterna(texto) || (formato < FORMATO_SIGLA_FINAL && terminaEnInicial(texto));
}

export function sanearCuriosidad(texto: string): string {
  return texto.replace(INVISIBLES, "").replace(CONTROLES, "").replace(/\s+/g, " ").trim();
}

const FUNDACION = /^(?:Se fundó|La institución se fundó) en \d/;
const APERTURA = /^(?:Se inauguró|Se abrió) en \d/;

const esDeWikidata = (i: ItemCuriosidad) => i.fuente === "wikidata";

// Sanea los items de una parada: limpia el texto, descarta los cortados por
// una abreviatura y los que empiezan en minúscula y, si hay hecho de apertura, el de fundación (es la fecha de
// la entidad, no la del edificio).
export function sanearItems(items: ItemCuriosidad[], formato: number = 0): ItemCuriosidad[] {
  const limpios = items
    .map((i) => ({ ...i, texto: sanearCuriosidad(i.texto) }))
    .filter((i) => i.texto.length > 0 && !empiezaEnMinuscula(i.texto) && !cortada(i.texto, formato));
  const hayApertura = limpios.some((i) => esDeWikidata(i) && APERTURA.test(i.texto));
  return hayApertura ? limpios.filter((i) => !(esDeWikidata(i) && FUNDACION.test(i.texto))) : limpios;
}

export function sanearFrases(frases: string[], formato: number = 0): string[] {
  return frases.map(sanearCuriosidad).filter((f) => f.length > 0 && !empiezaEnMinuscula(f) && !cortada(f, formato));
}
