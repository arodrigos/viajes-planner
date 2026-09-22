// Modelo del plan: viaje -> días -> franjas -> paradas, más el ancla de
// alojamiento por día. hora_inicio/hora_fin son INTERNAS a propósito (ver
// tipos-publicos.ts): son la traducción directa a ventana temporal de VROOM
// (costura con la fase 2) y no deben llegar nunca al cliente.

// En fase 1 la parada es "propuesto-sin-verificar" siempre: no hay ficha
// contra la que resolverla todavía. F2-08 añadirá los orígenes reales
// (ficha con fecha, ficha sin fecha, estimado); hasta entonces este es el
// único valor posible, no una enumeración a medio llenar.
export type FuenteProcedencia = "propuesto-sin-verificar";

export interface Procedencia {
  fuente: FuenteProcedencia;
}

// Las seis franjas de un día. Los límites horarios son configuración por
// destino (ver config-franjas.ts), nunca constantes aquí.
export interface Franja {
  id: string;
  etiqueta: string;
  hora_inicio: string; // "HH:MM"
  hora_fin: string; // "HH:MM"
}

// nombre y descripcion son lo único que la fase 1 escribe de verdad.
// coordenadas, ficha, apertura y presupuesto se declaran opcionales desde
// ahora para que las fases siguientes (resolución contra fichas, F2-02 en
// adelante) no obliguen a migrar los planes ya guardados: guardar un campo
// opcional sin usar cuesta la columna; añadirlo después cuesta reescribir
// cada plan existente.
export interface Parada {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  duracion_min: number;
  prioridad: number; // 0-100
  procedencia: Procedencia;
  coordenadas?: { lat: number; lon: number };
}

export type AnclaAlojamiento =
  | { tipo: "zona-propuesta"; centroide: { lat: number; lon: number }; radio_m: number }
  | { tipo: "usuario"; direccion: string };

export interface Dia {
  fecha: string; // "YYYY-MM-DD"
  // Opcional en fase 1: el modelo no propone alojamiento todavía (F2-06).
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: Franja[];
  paradas: Parada[];
}

// bloque recomendaciones-de-sitios: lo único que el modelo puede originar
// de verdad sobre un sitio de comida o un recinto -tipo, nombre y motivo-,
// nunca una dirección (ver urlBusquedaSitio.ts, que la construye aparte y
// de forma determinista). El propio tipo no admite un campo "url": es la
// misma defensa que ya usa Procedencia, ahora aplicada aquí.
export type TipoRecomendacion = "comida" | "recinto";

export interface Recomendacion {
  tipo: TipoRecomendacion;
  nombre: string;
  motivo: string;
}

export interface Plan {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: Dia[];
  // bloque generacion (ac2): explica en vez de callar cuando se excluyen
  // paradas por categoría de riesgo. Vacío o ausente cuando no hubo nada
  // que excluir.
  avisos?: string[];
  // bloque recomendaciones-de-sitios: vacío o ausente cuando el modelo no
  // propuso ninguna -el plan se guarda igual, nunca a medias por esto.
  recomendaciones?: Recomendacion[];
}
