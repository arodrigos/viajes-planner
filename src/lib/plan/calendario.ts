// ics-ac1/ics-ac3: generarIcsPlan es la EXCEPCIÓN documentada a la regla
// de no enviar horas de franja al cliente (esquema-plan-ac2): un fichero
// .ics sin hora no es un evento de calendario. Por eso recibe el `Plan`
// INTERNO (con `hora_inicio`/`hora_fin` en cada franja), nunca el
// `PlanPublico` que `aPlanPublico` ya sirve sin ellas -- esta función es
// el único sitio fuera del trabajador que lee esos dos campos.
import "server-only";
import { createEvents, type DateArray, type EventAttributes } from "ics";
import { slugDestino } from "@/lib/lugares/cacheSitios";
import type { Dia, Franja, Parada, Plan } from "./tipos";

const FRASE_HORARIO_ORIENTATIVO = "Horario orientativo según la franja del plan.";

function fechaHoraComoArray(fecha: string, hora: string): DateArray {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const [horaH, horaM] = hora.split(":").map(Number);
  return [anio, mes, dia, horaH, horaM];
}

// Las horas de franja son hora LOCAL del destino (config-franjas.ts), no
// UTC: "local"/"local" evita que `ics` las reconvierta según el huso del
// proceso que genera el fichero (no sería el mismo en VPS1 que en Vercel),
// y escribe DTSTART/DTEND como hora flotante, que es lo que un lector de
// calendario interpreta como "la hora que pone, sin más".
function eventoDeParada(dia: Dia, franja: Franja, parada: Parada, destino: string): EventAttributes {
  return {
    start: fechaHoraComoArray(dia.fecha, franja.hora_inicio),
    startInputType: "local",
    startOutputType: "local",
    end: fechaHoraComoArray(dia.fecha, franja.hora_fin),
    endInputType: "local",
    endOutputType: "local",
    title: parada.nombre,
    location: `${parada.nombre}, ${destino}`,
    description: `${parada.descripcion}\n\n${FRASE_HORARIO_ORIENTATIVO}`,
    ...(parada.coordenadas ? { geo: parada.coordenadas } : {}),
    ...(parada.lugar?.url ? { url: parada.lugar.url } : {}),
  };
}

export interface IcsPlan {
  contenido: string;
  nombreFichero: string;
}

export function generarIcsPlan(plan: Plan): IcsPlan {
  const eventos: EventAttributes[] = plan.dias.flatMap((dia) =>
    dia.paradas.map((parada) => {
      const franja = dia.franjas.find((f) => f.id === parada.franja_id);
      if (!franja) {
        throw new Error(`La parada ${parada.id} referencia una franja inexistente (${parada.franja_id})`);
      }
      return eventoDeParada(dia, franja, parada, plan.destino);
    }),
  );

  const { error, value } = createEvents(eventos, { calName: `Viaje a ${plan.destino}` });
  if (error || !value) {
    throw new Error(`No se pudo generar el calendario: ${error?.message ?? "sin detalle"}`);
  }

  return { contenido: value, nombreFichero: `${slugDestino(plan.destino)}.ics` };
}
