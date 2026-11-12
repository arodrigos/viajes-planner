import type { Fechas, Modo, Perfil } from "@/lib/criterios/tipos";
import type { TipoReserva } from "@/lib/reservas/tipos";

export type CategoriaPreparativo = "documentos" | "ninos" | "salud" | "ropa" | "electronica" | "antes-de-salir";

export interface ElementoPreparativo {
  id: string;
  categoria: CategoriaPreparativo;
  texto: string;
  porque: string;
  fuente?: { titulo: string; url: string; revisado: string };
}

// Solo datos estructurados: ningún texto libre del plan entra aquí.
export interface EntradaPreparativos {
  personas: { edad: number }[];
  perfil: Perfil;
  fechas: Fechas;
  dias: number;
  latitud: number | null;
  pais: string | null;
  transporte: Modo[];
  tiposReserva: TipoReserva[];
}

// Lo que el servidor da al dueño en /api/plan/[id] para que el cliente genere la
// lista (también sin red, desde la copia del plan): el resto de EntradaPreparativos
// sale del propio plan (latitud) y de las reservas (tipos).
export type DatosPreparativos = Pick<EntradaPreparativos, "personas" | "perfil" | "fechas" | "dias" | "transporte">;
