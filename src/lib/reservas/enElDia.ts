// reservas-en-el-dia: las reservas con hora como elementos fijos de un día.
// Puro y sin dependencias de servidor: lo usan el navegador (tarjetas y
// conflictos), el .ics y las pruebas. Un elemento fijo nunca se mueve: las
// operaciones de orden y de arreglo trabajan alrededor de él.
import { minutosDeHora } from "@/lib/plan/tiempos";
import type { Reserva, ReservaPublica, TipoReserva } from "./tipos";

export type ClaseFijo = "llegada" | "salida" | "entrada" | "hotel";

export interface ElementoFijo {
  reservaId: string;
  tipo: TipoReserva;
  clase: ClaseFijo;
  desdeMin: number;
  hastaMin: number;
  zona?: string;
  // El hotel no trae hora: se pinta al final del día y no choca con nada.
  sinHora?: true;
  // Solo en la vista del dueño: «MAD → FCO» o el nombre. Un invitado no lo recibe.
  detalle?: string;
}

// Duración que se da a una entrada sin hora de fin.
export const DURACION_ENTRADA_MIN = 90;
const FIN_DEL_DIA = 1439;

function hotelSinHora(id: string, detalle?: string): ElementoFijo {
  return { reservaId: id, tipo: "hotel", clase: "hotel", desdeMin: FIN_DEL_DIA, hastaMin: FIN_DEL_DIA, sinHora: true, ...(detalle ? { detalle } : {}) };
}

export function reservasDelDia(reservas: readonly Reserva[], fecha: string): ElementoFijo[] {
  const fijos: ElementoFijo[] = [];
  for (const r of reservas) {
    if (r.tipo === "vuelo" || r.tipo === "tren") {
      const ida = r.sentido === "ida";
      const dia = ida ? (r.fecha_fin ?? r.fecha_inicio) : r.fecha_inicio;
      const hora = ida ? r.hora_fin : r.hora_inicio;
      if (dia !== fecha || !hora) continue;
      const minutos = minutosDeHora(hora);
      const zona = ida ? r.zona_fin : r.zona_inicio;
      const detalle = r.origen && r.destino ? `${r.origen} → ${r.destino}` : undefined;
      fijos.push({ reservaId: r.id, tipo: r.tipo, clase: ida ? "llegada" : "salida", desdeMin: minutos, hastaMin: minutos, ...(zona ? { zona } : {}), ...(detalle ? { detalle } : {}) });
    } else if (r.tipo === "hotel") {
      if (r.fecha_inicio === fecha) fijos.push(hotelSinHora(r.id, r.nombre));
    } else if (r.fecha_inicio === fecha && r.hora_inicio) {
      const desde = minutosDeHora(r.hora_inicio);
      // Una hora de fin anterior (entrada que cruza la medianoche) se trata como la duración por defecto.
      const hasta = r.hora_fin && minutosDeHora(r.hora_fin) > desde ? minutosDeHora(r.hora_fin) : desde + DURACION_ENTRADA_MIN;
      fijos.push({ reservaId: r.id, tipo: "entrada", clase: "entrada", desdeMin: desde, hastaMin: hasta, ...(r.zona_inicio ? { zona: r.zona_inicio } : {}), ...(r.nombre ? { detalle: r.nombre } : {}) });
    }
  }
  return fijos.sort((a, b) => a.desdeMin - b.desdeMin || a.reservaId.localeCompare(b.reservaId));
}

// Lo mismo desde lo que ve un invitado: tipo genérico y hora, sin detalle.
export function reservasPublicasDelDia(reservas: readonly ReservaPublica[], fecha: string): ElementoFijo[] {
  const fijos: ElementoFijo[] = [];
  for (const r of reservas) {
    if (r.fecha !== fecha) continue;
    if (r.tipo === "hotel") {
      fijos.push(hotelSinHora(r.id));
      continue;
    }
    if (!r.hora) continue;
    const minutos = minutosDeHora(r.hora);
    if (r.tipo === "entrada") fijos.push({ reservaId: r.id, tipo: "entrada", clase: "entrada", desdeMin: minutos, hastaMin: minutos + DURACION_ENTRADA_MIN });
    else fijos.push({ reservaId: r.id, tipo: r.tipo, clase: r.sentido === "ida" ? "llegada" : "salida", desdeMin: minutos, hastaMin: minutos });
  }
  return fijos.sort((a, b) => a.desdeMin - b.desdeMin || a.reservaId.localeCompare(b.reservaId));
}

// El hotel con ubicación en cuya estancia cae el día (entrada y salida
// incluidas): de él sale el recorrido. Sin ubicación no hay ancla.
export function hotelDelDia(reservas: readonly Reserva[], fecha: string): Reserva | undefined {
  return reservas.find((r) => r.tipo === "hotel" && r.fecha_inicio <= fecha && fecha <= (r.fecha_fin ?? r.fecha_inicio));
}

// Franja que contiene la hora del elemento, o ninguna (queda al final del día).
export function franjaDelElemento(fijo: ElementoFijo, franjas: readonly { id: string; desdeMin: number; hastaMin: number }[]): string | null {
  if (fijo.sinHora) return null;
  return franjas.find((f) => fijo.desdeMin >= f.desdeMin && fijo.desdeMin < f.hastaMin)?.id ?? null;
}
