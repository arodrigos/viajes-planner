import { createHash } from "node:crypto";
import { CLASES_EDIFICIO, CLASES_INSTITUCION, MAX_FRASE, MIN_FRASE, REGEX_CANDIDATAS } from "./candidatas";
import { ARRANQUES, REGEX_PARTIR } from "./curiosidades";
import { ABREVIATURAS_INTERNAS, REGEX_SANEAR } from "./sanear";

// Huella de las reglas que deciden qué curiosidades se guardan. Lo que ya está
// en la base se escribió con unas reglas concretas: si cambian y no sube
// FORMATO_CURIOSIDADES, el trabajador no rehace nada y las frases malas se
// quedan para siempre (#171 subió FORMATO_GUIA en lugar de este). El test de
// huella.test.ts falla en cualquiera de los dos sentidos.
export function calcularHuellaReglas(umbrales: { min: number; max: number } = { min: MIN_FRASE, max: MAX_FRASE }): string {
  const canonico = JSON.stringify({
    // Los umbrales deciden qué frases son candidatas igual que una regex.
    minFrase: umbrales.min,
    maxFrase: umbrales.max,
    abreviaturas: [...ABREVIATURAS_INTERNAS],
    arranques: [...ARRANQUES].sort(),
    clasesInstitucion: [...CLASES_INSTITUCION].sort(),
    clasesEdificio: [...CLASES_EDIFICIO].sort(),
    regex: [...REGEX_SANEAR, ...REGEX_PARTIR, ...REGEX_CANDIDATAS].map((r) => r.source),
  });
  return createHash("sha256").update(canonico).digest("hex");
}

// Al cambiar las reglas: sube FORMATO_CURIOSIDADES (curiosidadesPlan.ts) y
// pon aquí el mismo número y la huella nueva que imprime el test.
export const HUELLA_REGLAS_CURIOSIDADES = {
  formato: 6,
  sha256: "7b6d2b3319d64736fbf41537a79f1c19343b84b6d7f0589586612714e19e15e6",
};
