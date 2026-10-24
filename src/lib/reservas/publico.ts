import type { Reserva, ReservaPublica } from "./tipos";

// Proyección explícita campo a campo (nunca un «quitar los sensibles»): un
// campo nuevo de Reserva no llega a un invitado salvo que alguien lo añada aquí.
// De un vuelo o tren, el invitado ve la llegada si es de ida y la salida si es
// de vuelta; del hotel, el día de entrada, sin hora.
export function aReservaPublica(reserva: Reserva): ReservaPublica {
  if (reserva.tipo === "vuelo" || reserva.tipo === "tren") {
    const ida = reserva.sentido === "ida";
    const fecha = ida ? (reserva.fecha_fin ?? reserva.fecha_inicio) : reserva.fecha_inicio;
    const hora = ida ? reserva.hora_fin : reserva.hora_inicio;
    return { id: reserva.id, tipo: reserva.tipo, ...(reserva.sentido ? { sentido: reserva.sentido } : {}), fecha, ...(hora ? { hora } : {}) };
  }
  return { id: reserva.id, tipo: reserva.tipo, fecha: reserva.fecha_inicio, ...(reserva.tipo === "entrada" && reserva.hora_inicio ? { hora: reserva.hora_inicio } : {}) };
}

export function aReservasPublicas(reservas: readonly Reserva[]): ReservaPublica[] {
  return reservas.map(aReservaPublica);
}
