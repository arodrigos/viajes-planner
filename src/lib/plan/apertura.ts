// apertura-conflictos: evaluación del horario de OSM de una parada contra una
// ventana del día. Pura y determinista: no lee el reloj ni el huso del proceso.
// La librería opening_hours trabaja con la hora de pared del Date que recibe,
// y las etiquetas de OSM son hora local del lugar, así que todo Date se
// construye con el constructor local (nunca desde una cadena ISO) y lo que
// devuelve se lee por sus campos locales.
import OpeningHours from "opening_hours";

export type EstadoApertura = "abierto" | "cerrado" | "desconocido";
export type MotivoDesconocido = "sin-horario" | "sin-festivos" | "regla-no-evaluable" | "intervalo-desconocido";

export interface IntervaloMin {
  desdeMin: number;
  hastaMin: number;
}

export interface ResultadoApertura {
  estado: EstadoApertura;
  // Tramos abiertos dentro de la ventana, en minutos desde la medianoche de `fecha`.
  intervalos: IntervaloMin[];
  motivoDesconocido?: MotivoDesconocido;
  fuente: "osm";
  // check_date:opening_hours de OSM, tal cual.
  comprobado?: string;
}

export interface EntradaApertura {
  opening_hours?: string;
  check_date?: string;
  // YYYY-MM-DD local del destino.
  fecha: string;
  desdeMin: number;
  hastaMin: number;
  duracionMin: number;
  lugar: { lat: number; lon: number; country_code?: string };
}

// Los festivos (PH) y las vacaciones escolares (SH) dependen del país: sin él
// la librería los trataría como días normales y daría un «abierto» o «cerrado»
// sin fundamento.
const USA_FESTIVOS = /\b(PH|SH)\b/;
const MAX_MEMORIA = 2000;
const memoria = new Map<string, ResultadoApertura>();

function desconocido(motivo: MotivoDesconocido, comprobado: string | undefined): ResultadoApertura {
  return { estado: "desconocido", intervalos: [], motivoDesconocido: motivo, fuente: "osm", ...(comprobado ? { comprobado } : {}) };
}

// Minutos de pared entre la medianoche de `fecha` y un Date local. Se resta en
// UTC sobre los campos locales para que un cambio de hora del proceso no
// añada ni quite una hora.
function minutosDePared(fecha: Date, base: { a: number; m: number; d: number }): number {
  const pared = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), fecha.getHours(), fecha.getMinutes());
  return Math.round((pared - Date.UTC(base.a, base.m - 1, base.d)) / 60_000);
}

function calcular(entrada: EntradaApertura): ResultadoApertura {
  const comprobado = entrada.check_date;
  const regla = entrada.opening_hours?.trim();
  if (!regla) return desconocido("sin-horario", comprobado);
  const pais = entrada.lugar.country_code?.trim().toLowerCase();
  if (USA_FESTIVOS.test(regla) && !pais) return desconocido("sin-festivos", comprobado);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entrada.fecha);
  if (!m || !Number.isFinite(entrada.desdeMin) || !Number.isFinite(entrada.hastaMin) || entrada.hastaMin <= entrada.desdeMin) {
    return desconocido("regla-no-evaluable", comprobado);
  }
  const base = { a: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };

  try {
    // La librería tipa `state` como obligatorio aunque solo lo usa para festivos regionales.
    const nominatim = pais ? { lat: entrada.lugar.lat, lon: entrada.lugar.lon, address: { country_code: pais, state: "" } } : undefined;
    const oh = nominatim ? new OpeningHours(regla, nominatim) : new OpeningHours(regla);
    const desde = new Date(base.a, base.m - 1, base.d, 0, entrada.desdeMin);
    const hasta = new Date(base.a, base.m - 1, base.d, 0, entrada.hastaMin);
    const crudos = oh.getOpenIntervals(desde, hasta);

    // Un intervalo marcado unknown (comentario, «por cita») no se puede dar
    // por abierto ni por cerrado.
    if (crudos.some((i) => i[2])) return desconocido("intervalo-desconocido", comprobado);

    const intervalos: IntervaloMin[] = [];
    for (const [ini, fin] of crudos) {
      const desdeMin = Math.max(entrada.desdeMin, minutosDePared(ini, base));
      const hastaMin = Math.min(entrada.hastaMin, minutosDePared(fin, base));
      if (hastaMin <= desdeMin) continue;
      const ultimo = intervalos[intervalos.length - 1];
      // 00:00-24:00 llega partido por la medianoche: se une.
      if (ultimo && ultimo.hastaMin >= desdeMin) ultimo.hastaMin = Math.max(ultimo.hastaMin, hastaMin);
      else intervalos.push({ desdeMin, hastaMin });
    }

    // Una visita más larga que la ventana (se pasa de la franja) se mide
    // contra la ventana entera: no es culpa del horario.
    const necesario = Math.min(entrada.duracionMin, entrada.hastaMin - entrada.desdeMin);
    const cabe = intervalos.some((i) => i.hastaMin - i.desdeMin >= necesario);
    return { estado: cabe ? "abierto" : "cerrado", intervalos, fuente: "osm", ...(comprobado ? { comprobado } : {}) };
  } catch {
    // Una regla que la librería no entiende nunca es «cerrado».
    return desconocido("regla-no-evaluable", comprobado);
  }
}

export function evaluarApertura(entrada: EntradaApertura): ResultadoApertura {
  const clave = JSON.stringify([entrada.opening_hours, entrada.check_date, entrada.lugar.country_code, entrada.lugar.lat, entrada.lugar.lon, entrada.fecha, entrada.desdeMin, entrada.hastaMin, entrada.duracionMin]);
  const guardado = memoria.get(clave);
  if (guardado) return guardado;
  const resultado = calcular(entrada);
  if (memoria.size >= MAX_MEMORIA) memoria.clear();
  memoria.set(clave, resultado);
  return resultado;
}
