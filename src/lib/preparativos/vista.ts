import type { OperacionCola } from "@/lib/sinConexion/colaSalida";
import type { ElementoPreparativo } from "./tipos";
import type { EstadoMarca } from "./validar";

export type EstadoSubida = "subida" | "pendiente" | "sin-sesion" | "rechazada";

export interface MarcaLocal {
  elemento: string;
  estado: EstadoMarca;
  actualizado_cliente: string;
}

export interface ElementoVista extends ElementoPreparativo {
  estado: EstadoMarca;
  subida: EstadoSubida;
}

export const claveMarca = (planId: string, elemento: string) => `marca:${planId}:${elemento}`;

// Lo que ve el dueño: la lista de la plantilla con las marcas del servidor (o
// del espejo) y, encima, lo que aún no se ha subido. Una marca de un elemento
// que ya no está en la plantilla se ignora.
export function componerLista(
  elementos: readonly ElementoPreparativo[],
  marcas: readonly MarcaLocal[],
  operaciones: readonly OperacionCola[],
  planId: string,
): ElementoVista[] {
  const base = new Map<string, { estado: EstadoMarca; subida: EstadoSubida }>(marcas.map((m) => [m.elemento, { estado: m.estado, subida: "subida" }]));
  const prefijo = claveMarca(planId, "");
  for (const op of operaciones) {
    if (!op.clave.startsWith(prefijo) || op.tipo !== "guardar") continue;
    const estado = (op.cuerpo as { estado?: EstadoMarca } | undefined)?.estado;
    if (estado !== "pendiente" && estado !== "hecho" && estado !== "no_hace_falta") continue;
    base.set(op.clave.slice(prefijo.length), { estado, subida: op.estado });
  }
  return elementos.map((e) => ({ ...e, ...(base.get(e.id) ?? { estado: "pendiente" as const, subida: "subida" as const }) }));
}

// Los que no hacen falta no cuentan en «N de M listos».
export function progreso(lista: readonly ElementoVista[]): { hechos: number; total: number } {
  const validos = lista.filter((e) => e.estado !== "no_hace_falta");
  return { hechos: validos.filter((e) => e.estado === "hecho").length, total: validos.length };
}

export const sinSubir = (lista: readonly ElementoVista[]) => lista.filter((e) => e.subida === "pendiente" || e.subida === "sin-sesion").length;
