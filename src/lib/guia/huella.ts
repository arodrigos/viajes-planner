import { createHash } from "node:crypto";
import { CLASES_EDIFICIO, CLASES_INSTITUCION, REGEX_CANDIDATAS } from "./candidatas";
import { ARRANQUES, REGEX_PARTIR } from "./curiosidades";
import { ABREVIATURAS_INTERNAS, REGEX_SANEAR } from "./sanear";

// Huella de las reglas que deciden qué curiosidades se guardan. Lo que ya está
// en la base se escribió con unas reglas concretas: si cambian y no sube
// FORMATO_CURIOSIDADES, el trabajador no rehace nada y las frases malas se
// quedan para siempre (#171 subió FORMATO_GUIA en lugar de este). El test de
// huella.test.ts falla en cualquiera de los dos sentidos.
export function calcularHuellaReglas(): string {
  const canonico = JSON.stringify({
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
  formato: 5,
  sha256: "50226dda1ba09e78e25e44f7e033c588bd8dc3ecf0d250fb3289e88ce58688c8",
};
