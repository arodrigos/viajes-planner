import { estimarTramo } from "@/lib/plan/tiempos";
import type { OpcionesTramos, PuntoTramo, Tramo } from "@/lib/plan/tramos";

// Los tests de tramos reciben puntos ya ubicados y consecutivos: es el caso
// de calcularTiemposDia sin paradas sin ubicar, y evita montar un día entero
// para probar un solo tramo.
export function tramosConsecutivos(puntos: readonly PuntoTramo[], opciones: OpcionesTramos): Tramo[] {
  return puntos.slice(1).map((destino, i) => estimarTramo(puntos[i], destino, opciones));
}
