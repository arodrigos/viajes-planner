import { randomBytes } from "node:crypto";

// modelo_amenazas (exposición de planes): identificadores aleatorios de
// alta entropía, nunca secuenciales. 16 bytes en base64url ~ 128 bits.
export function generarIdPlan(): string {
  return randomBytes(16).toString("base64url");
}

// trabajador-ac1 (real, 2026-09-21): el id de cada parada lo asigna el
// proceso, nunca el modelo -- mismo criterio que generarIdPlan. 8 bytes
// bastan aquí: no es un identificador expuesto en una URL propia, solo
// tiene que ser único dentro de un plan.
export function generarIdParada(): string {
  return randomBytes(8).toString("base64url");
}
