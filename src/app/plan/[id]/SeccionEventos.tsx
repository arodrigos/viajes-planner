import type { Evento, EventosVersion, TipoEvento } from "@/lib/eventos/tipos";
import { formatearFechaCorta } from "@/lib/etapas/ruta";

export const TEXTO_EVENTOS_EPOCA = "Indica fechas concretas para ver festivos y fiestas";
export const TEXTO_EVENTOS_VACIOS =
  "No hemos encontrado festivos ni fiestas registradas para estas fechas en OpenHolidays y Wikidata; puede haber fiestas locales que no figuren";
export const TEXTO_EVENTOS_FALLO = "No hemos podido consultar los eventos ahora mismo";
export const TEXTO_EVENTOS_PENDIENTES = "Todavía no hemos consultado los festivos y fiestas de este viaje";
export const AVISO_FESTIVO = "Algunos museos cierran o cambian de horario en festivo";

const ROTULO: Record<TipoEvento, string> = { festivo: "Festivo nacional", vacaciones: "Vacaciones escolares", fiesta: "Fiesta" };
const FUENTE: Record<Evento["fuente"], string> = { openholidays: "OpenHolidays", nager: "Nager.Date", wikidata: "Wikidata" };

// Los eventos que caen en un día; las vacaciones escolares duran semanas y solo
// van en el resumen del viaje, no repetidas en cada día.
export function eventosDelDia(eventos: Evento[] | undefined, fecha: string): Evento[] {
  return (eventos ?? []).filter((e) => e.tipo !== "vacaciones" && e.fecha <= fecha && fecha <= (e.fecha_fin ?? e.fecha));
}

function ItemEvento({ evento, conFecha }: { evento: Evento; conFecha: boolean }) {
  const rango = evento.fecha_fin ? `${formatearFechaCorta(evento.fecha)} – ${formatearFechaCorta(evento.fecha_fin)}` : formatearFechaCorta(evento.fecha);
  return (
    <li data-testid="evento">
      {conFecha && <>{rango} · </>}
      {ROTULO[evento.tipo]}: {evento.nombre} · {FUENTE[evento.fuente]}{" "}
      <a href={evento.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver en ${FUENTE[evento.fuente]}: ${evento.nombre}`}>
        <span aria-hidden="true">↗</span>
      </a>
    </li>
  );
}

// Eventos de un día, bajo su cabecera. Sin eventos no pinta nada: el estado
// vacío del viaje entero ya se dice en el resumen.
export function EventosDia({ eventos }: { eventos: Evento[] }) {
  if (eventos.length === 0) return null;
  return (
    <div className="eventos-dia" data-testid="eventos-dia">
      <ul className="pila">
        {eventos.map((e) => (
          <ItemEvento key={`${e.tipo}-${e.fecha}-${e.nombre}`} evento={e} conFecha={false} />
        ))}
      </ul>
      {eventos.some((e) => e.tipo === "festivo") && <p className="ayuda">{AVISO_FESTIVO}</p>}
    </div>
  );
}

export function SeccionEventos({ eventos }: { eventos?: EventosVersion }) {
  let cuerpo: React.ReactNode;
  if (!eventos) cuerpo = <p>{TEXTO_EVENTOS_PENDIENTES}</p>;
  else if (eventos.estado === "epoca") cuerpo = <p>{TEXTO_EVENTOS_EPOCA}</p>;
  else if (eventos.eventos.length === 0) cuerpo = <p>{eventos.estado === "fallo" ? TEXTO_EVENTOS_FALLO : TEXTO_EVENTOS_VACIOS}</p>;
  else
    cuerpo = (
      <>
        <ul className="pila">
          {eventos.eventos.map((e) => (
            <ItemEvento key={`${e.tipo}-${e.fecha}-${e.nombre}`} evento={e} conFecha />
          ))}
        </ul>
        {eventos.estado === "fallo" && <p className="ayuda">{TEXTO_EVENTOS_FALLO}: puede que falten eventos.</p>}
      </>
    );
  return (
    <section aria-label="Fiestas y festivos durante tu viaje" className="eventos-viaje" data-testid="eventos-viaje">
      <h3>Fiestas y festivos durante tu viaje</h3>
      {cuerpo}
    </section>
  );
}
