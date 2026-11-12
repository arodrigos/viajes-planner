import { ERRORES_PREPARATIVOS as E } from "@/lib/textos/preparativos";
import { IDS_PREPARATIVOS } from "./catalogo";

export const ESTADOS_MARCA = ["pendiente", "hecho", "no_hace_falta"] as const;
export type EstadoMarca = (typeof ESTADOS_MARCA)[number];

export interface MarcaEntrada {
  estado: EstadoMarca;
  actualizado_cliente: string;
}

export type ResultadoMarca = { ok: true; marca: MarcaEntrada } | { ok: false; error: string };

// Un reloj de móvil adelantado no debe dejar una marca «del futuro» que ninguna
// marca posterior pueda pisar; un día de margen cubre desfases y husos.
const MARGEN_FUTURO_MS = 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

// El elemento viene de la URL y el resto del cuerpo: se valida todo aquí.
export function validarMarca(elemento: string, cuerpo: unknown, ahora: number = Date.now()): ResultadoMarca {
  if (!IDS_PREPARATIVOS.has(elemento)) return { ok: false, error: E.elemento };
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) return { ok: false, error: E.cuerpo };
  const c = cuerpo as Record<string, unknown>;
  if (!ESTADOS_MARCA.includes(c.estado as EstadoMarca)) return { ok: false, error: E.estado };
  const fecha = c.actualizado_cliente;
  if (typeof fecha !== "string" || !ISO.test(fecha)) return { ok: false, error: E.fecha };
  const t = Date.parse(fecha);
  if (Number.isNaN(t) || t > ahora + MARGEN_FUTURO_MS) return { ok: false, error: E.fecha };
  return { ok: true, marca: { estado: c.estado as EstadoMarca, actualizado_cliente: new Date(t).toISOString() } };
}
