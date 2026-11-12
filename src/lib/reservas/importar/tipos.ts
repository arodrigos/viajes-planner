import type { ReservaEntrada, TipoReserva } from "../tipos";

export const MAX_BYTES_ICS = 262144;
export const MAX_EVENTOS_ICS = 20;

export type FormaFecha = "tzid" | "utc" | "flotante" | "fecha";

export interface Momento {
  fecha: string; // YYYY-MM-DD
  hora: string | null; // HH:MM
  zona: string | null; // IANA
  forma: FormaFecha;
  zonaDeducida: boolean;
}

export interface EventoIcs {
  indice: number;
  titulo: string;
  lugar: string | null;
  geo: { lat: number; lon: number } | null;
  inicio: Momento;
  fin: Momento | null;
  repeticionIgnorada: boolean;
}

export const MOTIVOS_FALLO = ["demasiado-grande", "no-es-ics", "sin-eventos", "demasiados-eventos", "malformado", "sin-conexion"] as const;
export type MotivoFallo = (typeof MOTIVOS_FALLO)[number];

export type ResultadoLecturaIcs = { ok: true; eventos: EventoIcs[] } | { ok: false; motivo: MotivoFallo };

export interface BorradorImportado {
  reserva: Partial<ReservaEntrada>;
  tipoSugerido: TipoReserva;
  // Campos que validarReserva exigirá y el fichero no trae.
  huecos: (keyof ReservaEntrada)[];
  // Campos que salen de una heurística y la persona debe revisar.
  deducidos: (keyof ReservaEntrada)[];
}
