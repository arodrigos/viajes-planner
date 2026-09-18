// Modelo del plan: viaje -> días -> franjas -> paradas, más el ancla de
// alojamiento por día. hora_inicio/hora_fin son INTERNAS a propósito (ver
// tipos-publicos.ts): son la traducción directa a ventana temporal de VROOM
// (costura con la fase 2) y no deben llegar nunca al cliente.

export type FuenteProcedencia = "oficial" | "secundaria" | "estimado";

export interface Procedencia {
  fuente: FuenteProcedencia;
  url?: string;
}

export interface Sitio {
  nombre: string;
  lat: number;
  lon: number;
}

// Las seis franjas de un día. Los límites horarios son configuración por
// destino (ver config-franjas.ts), nunca constantes aquí.
export interface Franja {
  id: string;
  etiqueta: string;
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
}

export interface Parada {
  id: string;
  franja_id: string;
  sitio: Sitio;
  duracion_min: number;
  prioridad: number; // 0-100
  procedencia: Procedencia;
}

export type AnclaAlojamiento =
  | { tipo: "zona-propuesta"; centroide: { lat: number; lon: number }; radio_m: number }
  | { tipo: "usuario"; direccion: string };

export interface Dia {
  fecha: string; // "YYYY-MM-DD"
  ancla_alojamiento: AnclaAlojamiento;
  franjas: Franja[];
  paradas: Parada[];
}

export interface Plan {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: Dia[];
}
