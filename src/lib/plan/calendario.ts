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
function conZona(ics: string, zonas: (string | null)[]): string {
  const sustituir = (etiqueta: "DTSTART" | "DTEND") => {
    let indice = 0;
    ics = ics.replace(new RegExp(`^${etiqueta}:(\\d{8}T\\d{6})\\r\\n`, "gm"), (linea, instante: string) => {
      const zona = zonas[indice++];
      return zona ? `${etiqueta};TZID=${zona}:${instante}\r\n` : linea;
    });
  };
  sustituir("DTSTART");
  sustituir("DTEND");
  return ics;
}

export interface IcsPlan {
  contenido: string;
  nombreFichero: string;
}

// `opciones` son las mismas que recibe aPlanPublico: si no, el .ics de un viaje
// familiar daría minutos distintos de los de la tarjeta.
export function generarIcsPlan(plan: Plan, opciones: OpcionesTramos): IcsPlan {
  const eventos: EventAttributes[] = [];
  const zonas: (string | null)[] = [];
  for (const dia of plan.dias) {
    const { horarios } = calcularTiemposDia(dia, opciones);
    for (const parada of dia.paradas) {
      const horario = horarios[parada.id];
      if (!horario) {
        throw new Error(`La parada ${parada.id} referencia una franja inexistente (${parada.franja_id})`);
      }
      eventos.push(eventoDeParada(dia, horario, parada, plan.destino));
      zonas.push(zonaDeParada(parada, plan.ciudad?.caja));
    }
  }

  const { error, value } = createEvents(eventos, { calName: `Viaje a ${plan.destino}` });
  if (error || !value) {
    throw new Error(`No se pudo generar el calendario: ${error?.message ?? "sin detalle"}`);
  }

  return { contenido: conZona(value, zonas), nombreFichero: `${slugDestino(plan.destino)}.ics` };
}
