// eventos: festivos y fiestas de un viaje con fechas concretas. Solo salen de
// OpenHolidays, Nager.Date y Wikidata: el modelo no puede rellenar ninguno.
export const FUENTES_EVENTO = ["openholidays", "nager", "wikidata"] as const;
export type FuenteEvento = (typeof FUENTES_EVENTO)[number];

// festivo = día festivo nacional; vacaciones = vacaciones escolares
// nacionales (un rango); fiesta = fiesta local de la ciudad (Wikidata).
export type TipoEvento = "festivo" | "vacaciones" | "fiesta";

export interface Evento {
  fecha: string; // AAAA-MM-DD
  // Solo en rangos (vacaciones, fiestas de varios días), ya recortado al
  // tramo del viaje.
  fecha_fin?: string;
  nombre: string;
  tipo: TipoEvento;
  fuente: FuenteEvento;
  url: string;
  // Índice de la etapa a la que pertenece (0 en un viaje de una ciudad).
  etapa: number;
  // Código ISO 3166-1 alfa-2 del país de esa etapa.
  pais?: string;
}

// «epoca»: el viaje no tiene fechas concretas, no se consulta nada.
// «fallo»: alguna fuente no respondió; los eventos son los que sí llegaron.
export type EstadoEventos = "consultado" | "epoca" | "fallo";

export interface EventosVersion {
  estado: EstadoEventos;
  consultado_en: string;
  eventos: Evento[];
}
