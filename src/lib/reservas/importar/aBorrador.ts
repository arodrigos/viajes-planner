import type { ReservaEntrada, TipoReserva } from "../tipos";
import { LIMITES, limpiarTexto } from "../validar";
import type { BorradorImportado, EventoIcs, Momento } from "./tipos";
import { aLocal, esZonaIana } from "./zona";

type Campo = keyof ReservaEntrada;

const recortar = (texto: string, max: number) => Array.from(texto).slice(0, max).join("");
// limpiarTexto quita los caracteres de control y el recorte respeta los topes de
// validarReserva: lo que sale de aquí ya pasa la validación en su longitud.
const texto = (valor: string | null, max: number): string | undefined => {
  if (valor === null) return undefined;
  const limpio = recortar(limpiarTexto(valor), max).trim();
  return limpio === "" ? undefined : limpio;
};

const PALABRAS_VUELO = /\b(vuelo|flight|aeropuerto|airport|airlines?|aerol[ií]nea)\b/i;
const PALABRAS_TREN = /\b(tren|train|renfe|iryo|ouigo)\b|\bAVE\b/i;
const PALABRAS_HOTEL = /\b(hotel|hostal|apartamento|apartment|alojamiento|check-?in)\b/i;
const PAR_IATA = /\b([A-Z]{3})\s*(?:->|[-–—>→])\s*([A-Z]{3})\b/;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Conservadora: ante la duda, «entrada» (la que menos exige). La persona la
// revisa siempre, por eso va en deducidos.
export function sugerirTipo(e: EventoIcs): TipoReserva {
  if (PALABRAS_VUELO.test(e.titulo)) return "vuelo";
  if (PALABRAS_TREN.test(e.titulo)) return "tren";
  if (PAR_IATA.test(e.titulo)) return "vuelo";
  if (PALABRAS_HOTEL.test(e.titulo)) return "hotel";
  if (e.inicio.hora === null && e.fin && diasEntre(e.inicio.fecha, e.fin.fecha) > 1) return "hotel";
  return "entrada";
}

// Solo patrones claros: «MAD-FCO» o «X → Y». Nada de adivinar con otra cosa.
function extremos(titulo: string): { origen: string; destino: string } | null {
  const iata = PAR_IATA.exec(titulo);
  if (iata) return { origen: iata[1], destino: iata[2] };
  const partes = titulo.split(/\s*(?:→|->|—|–)\s*|\s-\s/);
  if (partes.length !== 2) return null;
  const origen = partes[0]
    .replace(/^(?:(?:vuelo|flight|tren|train|renfe|ave|iryo|ouigo)\s+)+/i, "")
    .replace(/^[A-Z0-9]{2}\s?\d{2,4}\s+/, "")
    .trim();
  const destino = partes[1].split(/\s[·|]\s|[(:]/)[0].trim();
  return origen && destino ? { origen, destino } : null;
}

interface Resuelto {
  fecha: string;
  hora: string | null;
  zona: string | null;
  deducida: boolean;
}

// Un UTC sin zona solo se puede pasar a hora local con la del destino; sin ella
// no se inventa: la fecha y la hora quedan fuera y salen como hueco.
function resolver(m: Momento, zonaDestino: string | null): Resuelto | null {
  if (m.forma === "utc" && m.zona === null) {
    if (!zonaDestino || m.hora === null) return null;
    const [h, mi] = m.hora.split(":").map(Number);
    const [a, mes, d] = m.fecha.split("-").map(Number);
    return { ...aLocal(Date.UTC(a, mes - 1, d, h, mi), zonaDestino), zona: zonaDestino, deducida: true };
  }
  return { fecha: m.fecha, hora: m.hora, zona: m.zona, deducida: m.zonaDeducida };
}

const REQUERIDOS: Record<TipoReserva, Campo[]> = {
  vuelo: ["sentido", "origen", "destino", "fecha_inicio", "fecha_fin", "hora_inicio", "hora_fin"],
  tren: ["sentido", "origen", "destino", "fecha_inicio", "fecha_fin", "hora_inicio", "hora_fin"],
  hotel: ["nombre", "fecha_inicio", "fecha_fin"],
  entrada: ["nombre", "fecha_inicio", "hora_inicio"],
};

export function aBorradorReserva(evento: EventoIcs, contexto: { zonaDestino: string | null }): BorradorImportado {
  const tipo = sugerirTipo(evento);
  const zonaDestino = contexto.zonaDestino && esZonaIana(contexto.zonaDestino) ? contexto.zonaDestino : null;
  const reserva: Partial<ReservaEntrada> = { tipo };
  const deducidos: Campo[] = ["tipo"];
  const inicio = resolver(evento.inicio, zonaDestino);
  const fin = evento.fin ? resolver(evento.fin, zonaDestino) : null;
  const transporte = tipo === "vuelo" || tipo === "tren";

  if (inicio) reserva.fecha_inicio = inicio.fecha;

  if (transporte) {
    const par = extremos(limpiarTexto(evento.titulo));
    const origen = par && texto(par.origen, LIMITES.origen);
    const destino = par && texto(par.destino, LIMITES.destino);
    if (origen && destino) {
      reserva.origen = origen;
      reserva.destino = destino;
      deducidos.push("origen", "destino");
    }
    if (inicio?.hora) {
      reserva.hora_inicio = inicio.hora;
      if (inicio.zona) reserva.zona_inicio = inicio.zona;
      if (inicio.deducida) deducidos.push("zona_inicio");
    }
    if (fin) {
      reserva.fecha_fin = fin.fecha;
      if (fin.hora) {
        reserva.hora_fin = fin.hora;
        if (fin.zona) reserva.zona_fin = fin.zona;
        if (fin.deducida) deducidos.push("zona_fin");
      }
    }
  } else if (tipo === "hotel") {
    const nombre = texto(evento.titulo, LIMITES.nombre);
    if (nombre) reserva.nombre = nombre;
    const direccion = texto(evento.lugar, LIMITES.direccion);
    if (direccion) reserva.direccion = direccion;
    if (evento.geo) reserva.ubicacion = evento.geo;
    if (fin) reserva.fecha_fin = fin.fecha;
  } else {
    const nombre = texto(evento.titulo, LIMITES.nombre);
    if (nombre) reserva.nombre = nombre;
    if (inicio?.hora) {
      reserva.hora_inicio = inicio.hora;
      if (inicio.deducida) deducidos.push("hora_inicio");
    }
    // La entrada es de un solo día: una hora de fin en otro día no vale.
    if (inicio && fin?.hora && fin.fecha === inicio.fecha && inicio.hora && fin.hora > inicio.hora) reserva.hora_fin = fin.hora;
  }

  const huecos = REQUERIDOS[tipo].filter((c) => reserva[c] === undefined);
  return { reserva, tipoSugerido: tipo, huecos, deducidos };
}
