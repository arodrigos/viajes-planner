// guia-abierta: curiosidades = frases LITERALES del extracto de Wikipedia.
// Nada se reescribe ni se resume: lo que se enseña como «de Wikipedia» tiene
// que poder encontrarse tal cual en el artículo.
import { MAX_TEXTO } from "./wikitexto";

const MAX_FRASES = 2;

// Parte tras . ! ? solo si sigue un espacio y una mayúscula o cifra, para no
// cortar abreviaturas con minúscula detrás («a. C. y», «S. XVI» sí corta, y
// se acepta: una frase corta de más no es una frase inventada).
export function partirFrases(extracto: string): string[] {
  return extracto
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÜÑ¿¡0-9«"])/u)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

// Con 3 o más frases se descarta la primera (suele ser la definición, que ya
// dice la descripción de la parada); con una sola no hay curiosidades.
export function extraerCuriosidades(extracto: string): string[] {
  const frases = partirFrases(extracto);
  if (frases.length < 2) return [];
  const candidatas = frases.length >= 3 ? frases.slice(1) : frases;
  return candidatas.filter((f) => f.length >= 20 && f.length <= MAX_TEXTO && !/[{}[\]<>]/.test(f)).slice(0, MAX_FRASES);
}
