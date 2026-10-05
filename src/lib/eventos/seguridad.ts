// eventos: lo que llega de fuentes externas o de la base de datos se vuelve a
// comprobar antes de guardarse o de acabar en un href o en un texto.
import { FUENTES_EVENTO, type Evento, type EventosVersion } from "./tipos";

export const MAX_NOMBRE = 200;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SIN_MARCADO = /[{}[\]<>]/;

// Los identificadores de Wikidata se interpolan en la consulta SPARQL: es el
// único texto que entra en ella, y solo si tiene esta forma.
export const esIdQ = (valor: unknown): valor is string => typeof valor === "string" && /^Q[0-9]{1,12}$/.test(valor);
export const esPais = (valor: unknown): valor is string => typeof valor === "string" && /^[A-Z]{2}$/.test(valor);

export function esFecha(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FECHA.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
}

const HOSTS: Record<(typeof FUENTES_EVENTO)[number], (host: string) => boolean> = {
  openholidays: (h) => h === "www.openholidaysapi.org" || h === "openholidaysapi.org",
  nager: (h) => h === "date.nager.at",
  wikidata: (h) => h === "www.wikidata.org" || h.endsWith(".wikipedia.org"),
};

export function esUrlDeFuente(fuente: Evento["fuente"], url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const analizada = new URL(url);
    return analizada.protocol === "https:" && analizada.username === "" && analizada.password === "" && HOSTS[fuente]?.(analizada.hostname) === true;
  } catch {
    return false;
  }
}

// Texto plano y corto: se pinta con React como texto, nunca como HTML.
export function limpiarNombre(texto: string): string {
  return texto.replace(/<[^>]*>/g, " ").replace(/[{}[\]<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NOMBRE);
}

export function normalizarNombre(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function eventoSeguro(e: unknown): e is Evento {
  if (typeof e !== "object" || e === null) return false;
  const c = e as Partial<Evento>;
  return (
    esFecha(c.fecha) &&
    (c.fecha_fin === undefined || (esFecha(c.fecha_fin) && c.fecha_fin >= c.fecha)) &&
    typeof c.nombre === "string" &&
    c.nombre.length > 0 &&
    c.nombre.length <= MAX_NOMBRE &&
    !SIN_MARCADO.test(c.nombre) &&
    (c.tipo === "festivo" || c.tipo === "vacaciones" || c.tipo === "fiesta") &&
    typeof c.fuente === "string" &&
    (FUENTES_EVENTO as readonly string[]).includes(c.fuente) &&
    esUrlDeFuente(c.fuente, c.url) &&
    Number.isInteger(c.etapa) &&
    (c.pais === undefined || esPais(c.pais))
  );
}

export function eventosSeguros(datos: unknown): EventosVersion | undefined {
  if (typeof datos !== "object" || datos === null) return undefined;
  const d = datos as Partial<EventosVersion>;
  if (d.estado !== "consultado" && d.estado !== "epoca" && d.estado !== "fallo") return undefined;
  if (typeof d.consultado_en !== "string" || !Array.isArray(d.eventos)) return undefined;
  return { estado: d.estado, consultado_en: d.consultado_en, eventos: d.eventos.filter(eventoSeguro) };
}
