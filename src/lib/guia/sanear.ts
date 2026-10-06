// Saneado de curiosidades ya elegidas. Es una función pura y sin dependencias
// de servidor porque corre en dos sitios: al leer (así lo que ya está guardado
// sale limpio sin tocar la base) y en el trabajador, antes de guardar.
import type { ItemCuriosidad } from "@/lib/plan/tipos";

// U+200B, U+200C, U+200D, U+2060, U+00AD y U+FEFF: no se ven, pero rompen la
// búsqueda de la frase en el artículo y dejan huecos al partir líneas.
const INVISIBLES = /[​‌‍⁠­﻿]/g;
// Controles C0 y C1 salvo los espacios en blanco, que se normalizan después.
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

// Abreviaturas que NUNCA cierran una frase: lo que sigue es su continuación
// («Warner Bros. Studio Tour»). «a. C.» o «etc.» sí pueden cerrarla, así que
// no figuran aquí.
export const ABREVIATURAS_INTERNAS = ["Bros", "St", "Dr", "Dra", "Sr", "Sra", "Srta", "Mr", "Mrs", "Ms", "Jr", "Co", "Inc", "Ltd", "Av", "Avda", "Prof", "Gral", "Sto", "Sta"];

const TERMINA_EN_ABREVIATURA = new RegExp(`(?:^|[\\s(«"“'‘])(?:${ABREVIATURAS_INTERNAS.join("|")})\\.$`);

export function terminaEnAbreviatura(frase: string): boolean {
  return TERMINA_EN_ABREVIATURA.test(frase.trimEnd());
}

export function sanearCuriosidad(texto: string): string {
  return texto.replace(INVISIBLES, "").replace(CONTROLES, "").replace(/\s+/g, " ").trim();
}

const FUNDACION = /^(?:Se fundó|La institución se fundó) en \d/;
const APERTURA = /^(?:Se inauguró|Se abrió) en \d/;

const esDeWikidata = (i: ItemCuriosidad) => i.fuente === "wikidata";

// Sanea los items de una parada: limpia el texto, descarta los cortados por
// una abreviatura y, si hay hecho de apertura, el de fundación (es la fecha de
// la entidad, no la del edificio).
export function sanearItems(items: ItemCuriosidad[]): ItemCuriosidad[] {
  const limpios = items
    .map((i) => ({ ...i, texto: sanearCuriosidad(i.texto) }))
    .filter((i) => i.texto.length > 0 && !terminaEnAbreviatura(i.texto));
  const hayApertura = limpios.some((i) => esDeWikidata(i) && APERTURA.test(i.texto));
  return hayApertura ? limpios.filter((i) => !(esDeWikidata(i) && FUNDACION.test(i.texto))) : limpios;
}

export function sanearFrases(frases: string[]): string[] {
  return frases.map(sanearCuriosidad).filter((f) => f.length > 0 && !terminaEnAbreviatura(f));
}
