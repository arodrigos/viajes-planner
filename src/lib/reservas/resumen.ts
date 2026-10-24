import { TEXTOS_RESERVAS as T } from "@/lib/textos/reservas";
import type { Reserva } from "./tipos";

export function diaCorto(fecha: string): string {
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${fecha}T00:00:00Z`));
}

// Piezas de la línea de la tarjeta, en el orden en que se leen:
// «Vuelo de ida · MAD → FCO · llega 13:00 · ABC123».
export function piezasReserva(r: Reserva): string[] {
  const ida = r.sentido === "ida";
  switch (r.tipo) {
    case "vuelo":
    case "tren": {
      const titulo = r.tipo === "vuelo" ? (ida ? T.vueloIda : T.vueloVuelta) : ida ? T.trenIda : T.trenVuelta;
      const tiempo = ida ? (r.hora_fin ? T.llega(r.hora_fin) : "") : r.hora_inicio ? T.sale(r.hora_inicio) : "";
      return [titulo, `${r.origen ?? ""} → ${r.destino ?? ""}`, tiempo, r.localizador ?? ""].filter(Boolean);
    }
    case "hotel":
      return [`${T.hotel} ${r.nombre ?? ""}`.trim(), r.fecha_fin ? T.hasta(diaCorto(r.fecha_fin)) : "", r.ubicacion ? T.ubicacionOk : "", r.localizador ?? ""].filter(Boolean);
    case "entrada":
      return [`${T.entrada} ${r.nombre ?? ""}`.trim(), r.hora_inicio ? T.a(r.hora_inicio) : "", r.localizador ?? ""].filter(Boolean);
  }
}
