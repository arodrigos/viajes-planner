// horario-local (hor-ac1): rango «HH:MM – HH:MM» de cada parada, encadenado
// dentro de su franja. Puro y sin librerías de zona: las horas de franja ya
// son hora local del destino (config-franjas.ts), así que encadenar sobre
// ellas no necesita saber la zona; la zona solo hace falta para evaluar la
// apertura y para el TZID del .ics (zona.ts, solo servidor).
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import type { Dia, Franja, Parada } from "./tipos";

const VELOCIDAD_PASEO_KM_H = 4.5;
const MARGEN_PASEO_MIN = 5;
// Sin coordenadas en alguna de las dos paradas no hay distancia que
// dividir: una cifra fija y visible en vez de fingir precisión.
const PASEO_SIN_COORDENADAS_MIN = 15;

export interface HorarioParada {
  inicio: string; // "HH:MM", hora local del lugar
  fin: string;
  recortada: boolean;
}

export type Coordenadas = { lat: number; lon: number };

export function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

export function horaDeMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Minutos enteros a propósito: el invariante fin(i) + paseo == inicio(i+1)
// se cumple exacto y no hay redondeos distintos en la vista y en el .ics.
export function minutosDePaseo(desde?: Coordenadas, hasta?: Coordenadas): number {
  if (!desde || !hasta) return PASEO_SIN_COORDENADAS_MIN;
  const km = distanciaMetros(desde, hasta) / 1000;
  return Math.round((km / VELOCIDAD_PASEO_KM_H) * 60) + MARGEN_PASEO_MIN;
}

function horarioDeFranja(franja: Franja, paradas: Parada[]): Record<string, HorarioParada> {
  const resultado: Record<string, HorarioParada> = {};
  const limite = minutosDeHora(franja.hora_fin);
  let cursor = minutosDeHora(franja.hora_inicio);
  let agotada = false;

  paradas.forEach((parada, i) => {
    const fin = cursor + parada.duracion_min;
    if (agotada || fin > limite) {
      // Una vez que una parada no cabe, las siguientes tampoco: ninguna se
      // sale de la franja, se pegan a su final y avisan en la tarjeta.
      agotada = true;
      resultado[parada.id] = { inicio: horaDeMinutos(Math.min(cursor, limite)), fin: horaDeMinutos(limite), recortada: true };
      cursor = limite;
      return;
    }
    resultado[parada.id] = { inicio: horaDeMinutos(cursor), fin: horaDeMinutos(fin), recortada: false };
    cursor = fin + minutosDePaseo(parada.coordenadas, paradas[i + 1]?.coordenadas);
  });
  return resultado;
}

// Índice por id de parada. Cada franja arranca en su hora de inicio: el
// paseo no se arrastra de una franja a otra (la comida es un hueco, no un
// tramo andado).
export function calcularHorarioDia(dia: Pick<Dia, "franjas" | "paradas">): Record<string, HorarioParada> {
  const resultado: Record<string, HorarioParada> = {};
  for (const franja of dia.franjas) {
    Object.assign(resultado, horarioDeFranja(franja, dia.paradas.filter((p) => p.franja_id === franja.id)));
  }
  return resultado;
}

export function textoRango(horario: Pick<HorarioParada, "inicio" | "fin">): string {
  return `${horario.inicio} – ${horario.fin}`;
}

export function avisoRecortada(etiquetaFranja: string): string {
  return `Puede que no dé tiempo dentro de ${articuloFranja(etiquetaFranja)}`;
}

// «la mañana», «la tarde»: la etiqueta pública va en minúsculas con
// artículo; «Mañana temprano» -> «la mañana temprano».
function articuloFranja(etiqueta: string): string {
  return `la ${etiqueta.toLowerCase()}`;
}
