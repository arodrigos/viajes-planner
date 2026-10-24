import type { OperacionCola } from "@/lib/sinConexion/colaSalida";
import type { Gasto, GastoEntrada } from "./tipos";

export type EstadoGastoVista = "subido" | "pendiente" | "sin-sesion" | "rechazado";

export interface GastoVista extends Gasto {
  estado: EstadoGastoVista;
  error?: string;
}

export const claveGasto = (id: string) => `gasto:${id}`;

// Lo que ve el dueño: el espejo del servidor con lo pendiente encima. Un borrado
// pendiente quita el gasto al momento; un guardado pendiente lo crea o lo
// sustituye; un rechazado se ve en rojo (con el motivo) sin tapar al subido.
export function fusionarLista(espejo: readonly Gasto[], operaciones: readonly OperacionCola[]): GastoVista[] {
  const porId = new Map<string, GastoVista>(espejo.map((g) => [g.id, { ...g, estado: "subido" }]));
  for (const op of operaciones) {
    if (!op.clave.startsWith("gasto:")) continue;
    const id = op.clave.slice("gasto:".length);
    if (op.tipo === "borrar") {
      if (op.estado !== "rechazada") porId.delete(id);
      continue;
    }
    const estado: EstadoGastoVista = op.estado === "rechazada" ? "rechazado" : op.estado;
    porId.set(id, { id, ...(op.cuerpo as GastoEntrada), estado, ...(op.error ? { error: op.error } : {}) });
  }
  return [...porId.values()].sort((a, b) => b.actualizado_cliente.localeCompare(a.actualizado_cliente) || a.id.localeCompare(b.id));
}

// Los rechazados no están en el servidor y no cuentan en los totales.
export const paraTotales = (lista: readonly GastoVista[]): Gasto[] => lista.filter((g) => g.estado !== "rechazado");

export const sinSubir = (lista: readonly GastoVista[]) => lista.filter((g) => g.estado === "pendiente" || g.estado === "sin-sesion").length;
