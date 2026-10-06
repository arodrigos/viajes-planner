// sal-a-las: a qué hora salir para llegar a tiempo a la siguiente parada.
// Puro y sin reloj propio: quien llama pasa «ahora» ya en la zona del
// destino (minutosAhoraEnZona), nunca en la del dispositivo.
import { horaDeMinutos, minutosDeHora } from "./horario";

export const MARGEN_SALIDA_MIN = 5;

export type SalidaCalculada =
  | { estado: "a-tiempo"; salida: string; inicio: string }
  | { estado: "tarde"; llegada: string; retrasoMin: number };

export function horaDeSalida(
  inicioSiguiente: string | undefined,
  minutosTramo: number | undefined,
  ahoraLocal: number,
  margen: number = MARGEN_SALIDA_MIN,
): SalidaCalculada | null {
  if (!inicioSiguiente || minutosTramo === undefined || !/^\d{1,2}:\d{2}$/.test(inicioSiguiente)) return null;
  const inicio = minutosDeHora(inicioSiguiente);
  const salida = inicio - minutosTramo - margen;
  if (ahoraLocal <= salida) return { estado: "a-tiempo", salida: horaDeMinutos(salida), inicio: horaDeMinutos(inicio) };
  const llegada = ahoraLocal + minutosTramo;
  return { estado: "tarde", llegada: horaDeMinutos(llegada % 1440), retrasoMin: Math.max(0, llegada - inicio) };
}

// Minutos desde medianoche en la zona del destino. Una zona desconocida cae
// en la del dispositivo, como hoyEnZona.
export function minutosAhoraEnZona(zona: string | undefined, ahora: Date = new Date()): number {
  const leer = (timeZone: string | undefined) => {
    const partes = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) }).formatToParts(ahora);
    const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
    return valor("hour") * 60 + valor("minute");
  };
  try {
    return leer(zona);
  } catch {
    return leer(undefined);
  }
}
