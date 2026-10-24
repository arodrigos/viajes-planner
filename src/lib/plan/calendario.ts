// ics-ac1/ics-ac3: generarIcsPlan es la EXCEPCIÓN documentada a la regla
// de no enviar horas de franja al cliente (esquema-plan-ac2): un fichero
// .ics sin hora no es un evento de calendario. Por eso recibe el `Plan`
// INTERNO (con `hora_inicio`/`hora_fin` en cada franja), nunca el
// `PlanPublico` que `aPlanPublico` ya sirve sin ellas -- esta función es
// el único sitio fuera del trabajador que lee esos dos campos.
import "server-only";
import { createEvents, type DateArray, type EventAttributes } from "ics";
import { slugDestino } from "@/lib/lugares/cacheSitios";
import { calcularTiemposDia, type HorarioCalculado } from "./tiempos";
import type { OpcionesTramos } from "./tramos";
import type { Dia, Parada, Plan } from "./tipos";
import { zonaDeParada } from "./zona";
import { aReservasPublicas } from "@/lib/reservas/publico";
import { TEXTOS_RESERVAS as TR } from "@/lib/textos/reservas";
import type { Reserva, ReservaPublica } from "@/lib/reservas/tipos";

const FRASE_HORARIO_ORIENTATIVO = "Horario orientativo según la franja del plan.";

// Los minutos pueden pasar de 1440 (una parada que cruza la medianoche): el
// paso al día siguiente lo da Date.UTC, así que nunca sale una hora «24:35».
function fechaHoraComoArray(fecha: string, minutos: number): DateArray {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia, 0, minutos));
  return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes()];
}

// hor-ac1: los mismos rangos que enseña la tarjeta (calcularTiemposDia), no
// la ventana entera de la franja. Son hora LOCAL del lugar: "local"/"local"
// evita que `ics` las reconvierta según el huso del proceso (no sería el
// mismo en el trabajador que en Vercel); la zona se añade después como TZID (ver
// conZona), porque `ics` solo sabe escribir hora flotante o UTC.
function eventoDeParada(dia: Dia, horario: HorarioCalculado, parada: Parada, destino: string): EventAttributes {
  return {
    start: fechaHoraComoArray(dia.fecha, horario.inicioMin),
    startInputType: "local",
    startOutputType: "local",
    end: fechaHoraComoArray(dia.fecha, horario.finMin),
    endInputType: "local",
    endOutputType: "local",
    title: parada.nombre,
    location: `${parada.nombre}, ${destino}`,
    // La nota del sitio propio es texto del usuario: `ics` la escapa según
    // RFC 5545 (comas, punto y coma, barras y saltos de línea).
    description: `${parada.descripcion}${parada.nota ? `\n\n${parada.nota}` : ""}\n\n${FRASE_HORARIO_ORIENTATIVO}`,
    ...(parada.coordenadas ? { geo: parada.coordenadas } : {}),
    ...(parada.lugar?.url ? { url: parada.lugar.url } : {}),
  };
}

// Convierte la hora flotante de cada DTSTART/DTEND en una con TZID. Los
// eventos salen en el mismo orden en que se pasaron y cada uno lleva
// exactamente un DTSTART y un DTEND. Sin zona conocida se deja flotante.
// No se añade VTIMEZONE: los lectores de calendario resuelven el nombre
// IANA por su cuenta y el fichero sigue siendo válido para ellos.
function conZona(ics: string, zonas: { inicio: string | null; fin: string | null }[]): string {
  // Cada VEVENT lleva un DTSTART y un DTEND, pero un evento de día entero (el
  // hotel) no tiene hora flotante que reemplazar: se cuenta igual para no
  // desplazar las zonas de los eventos que vienen detrás.
  const sustituir = (etiqueta: "DTSTART" | "DTEND", cual: "inicio" | "fin") => {
    let indice = 0;
    ics = ics.replace(new RegExp(`^${etiqueta}(?::(\\d{8}T\\d{6})|[^\\r\\n]*)\\r\\n`, "gm"), (linea, instante?: string) => {
      const zona = zonas[indice++]?.[cual];
      return instante && zona ? `${etiqueta};TZID=${zona}:${instante}\r\n` : linea;
    });
  };
  sustituir("DTSTART", "inicio");
  sustituir("DTEND", "fin");
  return ics;
}

export interface IcsPlan {
  contenido: string;
  nombreFichero: string;
}

type Zonas = { inicio: string | null; fin: string | null };

function sumarDias(fecha: string, dias: number): DateArray {
  const [a, m, d] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
}

const minutosDe = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
const DURACION_PUBLICA_MIN = 30;
const DURACION_ENTRADA_MIN = 90;

// El hotel es un evento de día entero: el .ics no inventa una hora de entrada.
function hotelDiaEntero(inicio: string, fin: string | undefined, title: string, extra: Partial<EventAttributes> = {}): EventAttributes {
  const hasta = fin && fin > inicio ? fin : undefined;
  return { start: sumarDias(inicio, 0), end: hasta ? sumarDias(hasta, 0) : sumarDias(inicio, 1), title, ...extra };
}

function horaLocal(fecha: string, hora: string) {
  return { start: fechaHoraComoArray(fecha, minutosDe(hora)), startInputType: "local" as const, startOutputType: "local" as const };
}

function finLocal(fecha: string, minutos: number) {
  return { end: fechaHoraComoArray(fecha, minutos), endInputType: "local" as const, endOutputType: "local" as const };
}

// Un evento por reserva del dueño: el vuelo o tren va de su salida a su
// llegada, cada extremo con su zona. El localizador solo está aquí.
function eventoDeReserva(r: Reserva, zonaPlan: string | null): { evento: EventAttributes; zonas: Zonas } | null {
  const detalle = [r.localizador ? `Localizador: ${r.localizador}` : "", r.direccion ?? "", r.notas ?? ""].filter(Boolean).join("\n");
  const description = detalle || undefined;
  if (r.tipo === "vuelo" || r.tipo === "tren") {
    if (!r.hora_inicio || !r.hora_fin || !r.fecha_fin) return null;
    const ida = r.sentido === "ida";
    const titulo = r.tipo === "vuelo" ? (ida ? TR.vueloIda : TR.vueloVuelta) : ida ? TR.trenIda : TR.trenVuelta;
    return {
      evento: { ...horaLocal(r.fecha_inicio, r.hora_inicio), ...finLocal(r.fecha_fin, minutosDe(r.hora_fin)), title: `${titulo} · ${r.origen ?? ""} → ${r.destino ?? ""}`, ...(description ? { description } : {}) },
      zonas: { inicio: r.zona_inicio ?? null, fin: r.zona_fin ?? null },
    };
  }
  if (r.tipo === "hotel") {
    return {
      evento: hotelDiaEntero(r.fecha_inicio, r.fecha_fin, `${TR.hotel} ${r.nombre ?? ""}`.trim(), { ...(r.direccion ? { location: r.direccion } : {}), ...(description ? { description } : {}) }),
      zonas: { inicio: null, fin: null },
    };
  }
  if (!r.hora_inicio) return null;
  const desde = minutosDe(r.hora_inicio);
  const hasta = r.hora_fin && minutosDe(r.hora_fin) > desde ? minutosDe(r.hora_fin) : desde + DURACION_ENTRADA_MIN;
  const zona = r.zona_inicio ?? zonaPlan;
  return {
    evento: { ...horaLocal(r.fecha_inicio, r.hora_inicio), ...finLocal(r.fecha_inicio, hasta), title: `${TR.entrada} ${r.nombre ?? ""}`.trim(), ...(r.direccion ? { location: r.direccion } : {}), ...(description ? { description } : {}) },
    zonas: { inicio: zona, fin: zona },
  };
}

// Para quien no es el dueño: solo el tipo genérico y la hora, nada de lo que
// escribió el dueño.
function eventoDeReservaPublica(r: ReservaPublica, zonaPlan: string | null): { evento: EventAttributes; zonas: Zonas } | null {
  if (r.tipo === "hotel") return { evento: hotelDiaEntero(r.fecha, undefined, TR.hotel), zonas: { inicio: null, fin: null } };
  if (!r.hora) return null;
  const desde = minutosDe(r.hora);
  const titulo = r.tipo === "entrada" ? TR.entrada : r.sentido === "ida" ? TR.llegada : TR.salida;
  const hasta = desde + (r.tipo === "entrada" ? DURACION_ENTRADA_MIN : DURACION_PUBLICA_MIN);
  return { evento: { ...horaLocal(r.fecha, r.hora), ...finLocal(r.fecha, hasta), title: titulo }, zonas: { inicio: zonaPlan, fin: zonaPlan } };
}

// `opciones` son las mismas que recibe aPlanPublico: si no, el .ics de un viaje
// familiar daría minutos distintos de los de la tarjeta. `conDetalle` solo es
// verdadero para el dueño: un invitado recibe únicamente el tipo y la hora.
export function generarIcsPlan(plan: Plan, opciones: OpcionesTramos, reservas: readonly Reserva[] = [], conDetalle = true): IcsPlan {
  const eventos: EventAttributes[] = [];
  const zonas: Zonas[] = [];
  for (const dia of plan.dias) {
    const { horarios } = calcularTiemposDia(dia, opciones);
    for (const parada of dia.paradas) {
      const horario = horarios[parada.id];
      if (!horario) {
        throw new Error(`La parada ${parada.id} referencia una franja inexistente (${parada.franja_id})`);
      }
      eventos.push(eventoDeParada(dia, horario, parada, plan.destino));
      const zona = zonaDeParada(parada, plan.ciudad?.caja);
      zonas.push({ inicio: zona, fin: zona });
    }
  }
  const zonaPlan = zonas.find((z) => z.inicio)?.inicio ?? null;
  const ordenadas = [...reservas].sort((a, b) => `${a.fecha_inicio}T${a.hora_inicio ?? ""}`.localeCompare(`${b.fecha_inicio}T${b.hora_inicio ?? ""}`));
  const deReservas = conDetalle ? ordenadas.map((r) => eventoDeReserva(r, zonaPlan)) : aReservasPublicas(ordenadas).map((r) => eventoDeReservaPublica(r, zonaPlan));
  for (const e of deReservas) {
    if (!e) continue;
    eventos.push(e.evento);
    zonas.push(e.zonas);
  }

  const { error, value } = createEvents(eventos, { calName: `Viaje a ${plan.destino}` });
  if (error || !value) {
    throw new Error(`No se pudo generar el calendario: ${error?.message ?? "sin detalle"}`);
  }

  return { contenido: conZona(value, zonas), nombreFichero: `${slugDestino(plan.destino)}.ics` };
}
