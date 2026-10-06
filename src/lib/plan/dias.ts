// vista-por-dias: lógica pura del selector de día. Vive fuera de los
// componentes para poder probarla con property tests sin montar nada.

export type DiaElegido = "resumen" | number;

// El número de día es 1..N, el mismo que se ve en el chip y en la URL.
export function diaPorDefecto(fechas: readonly string[], hoy: string): DiaElegido {
  const i = fechas.indexOf(hoy);
  return i === -1 ? "resumen" : i + 1;
}

// ?dia llega de la URL, es decir, de cualquiera: nunca debe lanzar y todo lo
// que no sea un día válido cae en el valor por defecto que decide quien llama.
export function leerDiaDeUrl(valor: string | null | undefined, total: number): DiaElegido | null {
  if (valor === "resumen") return "resumen";
  if (valor === null || valor === undefined || !/^[1-9][0-9]{0,5}$/.test(valor)) return null;
  const n = Number(valor);
  return n <= total ? n : null;
}

export function valorParaUrl(dia: DiaElegido): string {
  return String(dia);
}

// «Hoy» se calcula en la zona del destino y no en la del móvil: un viajero con
// el móvil aún en su zona de origen vería el día equivocado a primera y última hora.
export function hoyEnZona(zona: string | undefined, ahora: Date = new Date()): string {
  const partes = (zona: string | undefined) =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(zona ? { timeZone: zona } : {}) }).format(ahora);
  try {
    return partes(zona);
  } catch {
    return partes(undefined);
  }
}

function partesFecha(iso: string) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const formato = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { ...opciones, timeZone: "UTC" }).format(fecha);
  return { semana: formato({ weekday: "short" }).replace(".", ""), dia: formato({ day: "numeric" }), mes: formato({ month: "short" }).replace(".", "") };
}

// «mié 16 oct»: el ISO crudo nunca llega a la pantalla.
export function formatearFechaDia(iso: string): string {
  const { semana, dia, mes } = partesFecha(iso);
  return `${semana} ${dia} ${mes}`;
}

// «mié 16»: lo que cabe en un chip del selector.
export function formatearFechaChip(iso: string): string {
  const { semana, dia } = partesFecha(iso);
  return `${semana} ${dia}`;
}
