// Lector de .ics en el navegador. ical.js se carga con import() dinámico: nunca
// entra en el JS inicial de la página ni en una función de servidor, y el
// fichero no sale del dispositivo (imp-ac7).
import type ICALTipo from "ical.js";
import { aLocal, esZonaIana } from "./zona";
import { MAX_BYTES_ICS, MAX_EVENTOS_ICS, MOTIVOS_FALLO } from "./tipos";
import type { EventoIcs, MotivoFallo, Momento, ResultadoLecturaIcs } from "./tipos";

export { MAX_BYTES_ICS, MAX_EVENTOS_ICS, MOTIVOS_FALLO };

type ICAL = typeof ICALTipo;
type Componente = InstanceType<ICAL["Component"]>;

// Antes de leer el contenido: un fichero grande no se carga en memoria.
export function comprobarFichero(f: { size: number; name: string; type: string }): MotivoFallo | null {
  return f.size > MAX_BYTES_ICS ? "demasiado-grande" : null;
}

const dos = (n: number) => String(n).padStart(2, "0");
const fechaDe = (t: { year: number; month: number; day: number }) => `${String(t.year).padStart(4, "0")}-${dos(t.month)}-${dos(t.day)}`;

function leerGeo(vevent: Componente): EventoIcs["geo"] {
  try {
    const g = vevent.getFirstPropertyValue("geo") as unknown;
    if (!Array.isArray(g)) return null;
    const [lat, lon] = g.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  } catch {
    return null;
  }
}

async function cargarTzLookup(): Promise<((lat: number, lon: number) => string) | null> {
  try {
    const m = await import("@photostructure/tz-lookup");
    return m.default;
  } catch {
    return null;
  }
}

function leerMomento(vevent: Componente, nombre: "dtstart" | "dtend", zonaGeo: string | null): Momento | null {
  const prop = vevent.getFirstProperty(nombre);
  if (!prop) return null;
  const t = prop.getFirstValue() as unknown as { isDate: boolean; year: number; month: number; day: number; hour: number; minute: number; zone?: { tzid?: string } } | null;
  if (!t || typeof t.year !== "number") return null;
  if (t.isDate) return { fecha: fechaDe(t), hora: null, zona: null, forma: "fecha", zonaDeducida: false };

  const tzid = prop.getParameter("tzid");
  const hora = `${dos(t.hour)}:${dos(t.minute)}`;
  if (typeof tzid === "string" && tzid !== "") {
    // Una zona que no es IANA (p. ej. «Romance Standard Time») no se traduce:
    // inventarla crearía conflictos falsos. Se conserva la hora de pared.
    if (esZonaIana(tzid)) return { fecha: fechaDe(t), hora, zona: tzid, forma: "tzid", zonaDeducida: false };
    return { fecha: fechaDe(t), hora, zona: null, forma: "flotante", zonaDeducida: false };
  }
  if (t.zone?.tzid === "UTC") {
    if (zonaGeo) {
      const local = aLocal(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute), zonaGeo);
      return { ...local, zona: zonaGeo, forma: "utc", zonaDeducida: false };
    }
    // Sin zona conocida se queda en UTC; aBorradorReserva la pasa a la del destino.
    return { fecha: fechaDe(t), hora, zona: null, forma: "utc", zonaDeducida: false };
  }
  return { fecha: fechaDe(t), hora, zona: null, forma: "flotante", zonaDeducida: false };
}

export async function leerIcs(texto: string): Promise<ResultadoLecturaIcs> {
  try {
    if (!/^\s*BEGIN:VCALENDAR/im.test(texto)) return { ok: false, motivo: "no-es-ics" };
    // Contar antes de parsear: un fichero con miles de eventos no llega a ical.js.
    const total = (texto.match(/^BEGIN:VEVENT\s*$/gim) ?? []).length;
    if (total === 0) return { ok: false, motivo: "sin-eventos" };
    if (total > MAX_EVENTOS_ICS) return { ok: false, motivo: "demasiados-eventos" };

    let ICAL: ICAL;
    try {
      ICAL = (await import("ical.js")).default;
    } catch {
      return { ok: false, motivo: "sin-conexion" };
    }

    // Una reserva es un evento único: las reglas de repetición no se expanden
    // (superficie histórica de bloqueos) y una RRULE malformada haría lanzar al
    // parser, así que se renombra antes de parsear y solo se anota que existía.
    const sinRepeticion = texto.replace(/^(RRULE|EXRULE)([:;])/gim, "X-IGNORADA-$1$2");
    const raiz = new ICAL.Component(ICAL.parse(sinRepeticion));
    const tzLookup = await cargarTzLookup();

    const eventos: EventoIcs[] = [];
    for (const [indice, v] of raiz.getAllSubcomponents("vevent").entries()) {
      const geo = leerGeo(v);
      let zonaGeo: string | null = null;
      if (geo && tzLookup) {
        try {
          zonaGeo = tzLookup(geo.lat, geo.lon);
        } catch {
          zonaGeo = null;
        }
      }
      const inicio = leerMomento(v, "dtstart", zonaGeo);
      if (!inicio) continue;
      // El GEO es del lugar del evento, no del de llegada: el fin no lo usa.
      const fin = leerMomento(v, "dtend", null);
      const titulo = v.getFirstPropertyValue("summary");
      const lugar = v.getFirstPropertyValue("location");
      eventos.push({
        indice,
        titulo: typeof titulo === "string" ? titulo : "",
        lugar: typeof lugar === "string" && lugar !== "" ? lugar : null,
        geo,
        inicio,
        fin,
        repeticionIgnorada: v.hasProperty("x-ignorada-rrule") || v.hasProperty("x-ignorada-exrule"),
      });
    }
    if (eventos.length === 0) return { ok: false, motivo: "malformado" };
    return { ok: true, eventos };
  } catch {
    return { ok: false, motivo: "malformado" };
  }
}
