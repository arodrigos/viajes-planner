import { randomBytes } from "node:crypto";

// modelo_amenazas (exposición de planes): identificadores aleatorios de
// alta entropía, nunca secuenciales. 16 bytes en base64url ~ 128 bits.
export function generarIdPlan(): string {
  return randomBytes(16).toString("base64url");
}
