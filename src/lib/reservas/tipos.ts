export const TIPOS_RESERVA = ["vuelo", "tren", "hotel", "entrada"] as const;
export type TipoReserva = (typeof TIPOS_RESERVA)[number];

export interface Reserva {
  id: string;
  tipo: TipoReserva;
  sentido?: "ida" | "vuelta";
  fecha_inicio: string;
  hora_inicio?: string;
  zona_inicio?: string;
  fecha_fin?: string;
  hora_fin?: string;
  zona_fin?: string;
  origen?: string;
  destino?: string;
  nombre?: string;
  direccion?: string;
  localizador?: string;
  notas?: string;
  ubicacion?: { lat: number; lon: number };
}

// Lo único que recibe un invitado (decisión de Adrián): el tipo genérico y la
// hora. Ni nombre, ni origen y destino, ni localizador, dirección, ubicación o
// notas. Se pinta «Llegada», «Salida», «Entrada» u «Hotel» con su hora.
export interface ReservaPublica {
  id: string;
  tipo: TipoReserva;
  sentido?: "ida" | "vuelta";
  fecha: string;
  hora?: string;
}

// Lo que se escribe de una reserva: todo menos el id, que pone la base.
export type ReservaEntrada = Omit<Reserva, "id">;

export const TOPE_RESERVAS = 30;
