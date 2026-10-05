// motivo-y-presupuesto (mot-ac2): el modelo propone motivo y coste, pero
// cualquiera de los dos mal formado se descarta aquí sin invalidar el plan:
// un motivo largo o un precio absurdo no justifica reintentar la generación.
import type { CosteParada } from "@/lib/plan/tipos";

export const MOTIVO_MAX = 300;
export const COSTE_MAX_EUR_PERSONA = 2000;

export function ensamblarMotivo(cruda: unknown): string | undefined {
  if (typeof cruda !== "string") return undefined;
  const motivo = cruda.trim();
  return motivo.length >= 1 && motivo.length <= MOTIVO_MAX ? motivo : undefined;
}

// `ahora` inyectado: el ensamblador es determinista y los tests no dependen
// del reloj.
export function ensamblarCoste(cruda: unknown, ahora: Date): CosteParada | undefined {
  if (typeof cruda !== "number" || !Number.isFinite(cruda)) return undefined;
  if (cruda < 0 || cruda > COSTE_MAX_EUR_PERSONA) return undefined;
  return {
    importe_eur: cruda,
    por: cruda === 0 ? "gratis" : "persona",
    procedencia: "estimado",
    fecha: ahora.toISOString().slice(0, 10),
  };
}
