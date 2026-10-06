// Errores de acción por parada. Cada parada es dueña del suyo: fijar o
// limpiar el de una nunca toca el de otra. Las operaciones son puras
// (devuelven un Map nuevo) para poder usarlas con useState sin mutar.
export type TipoErrorParada = "cambio" | "visita";

export interface ErrorParada {
  tipo: TipoErrorParada;
  mensaje: string;
}

export type ErroresParada = ReadonlyMap<string, ErrorParada>;

export const ERRORES_VACIOS: ErroresParada = new Map();

export function fijarError(errores: ErroresParada, paradaId: string, error: ErrorParada): ErroresParada {
  const siguiente = new Map(errores);
  siguiente.set(paradaId, error);
  return siguiente;
}

export function limpiarError(errores: ErroresParada, paradaId: string): ErroresParada {
  if (!errores.has(paradaId)) return errores;
  const siguiente = new Map(errores);
  siguiente.delete(paradaId);
  return siguiente;
}

export function leerError(errores: ErroresParada, paradaId: string): ErrorParada | undefined {
  return errores.get(paradaId);
}
