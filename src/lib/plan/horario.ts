// horario-local (hor-ac1): rango «HH:MM – HH:MM» de cada parada. Los minutos
// salen de tiempos.ts (el único cálculo); aquí solo se pasan a texto para la
// vista. Puro y sin librerías de zona: las horas de franja ya son hora local
// del destino (config-franjas.ts); la zona solo hace falta para evaluar la
// apertura y para el TZID del .ics (zona.ts, solo servidor).
import { calcularTiemposDia, horaDeMinutos, minutosDeHora } from "./tiempos";
import type { OpcionesTramos } from "./tramos";
import type { Dia } from "./tipos";

export { horaDeMinutos, minutosDeHora };

export interface HorarioParada {
  inicio: string; // "HH:MM", hora local del lugar, módulo 24 h
  fin: string;
  recortada: boolean;
}

export type Coordenadas = { lat: number; lon: number };

export function calcularHorarioDia(dia: Pick<Dia, "franjas" | "paradas">, opciones: OpcionesTramos): Record<string, HorarioParada> {
  const { horarios } = calcularTiemposDia(dia, opciones);
  return Object.fromEntries(
    Object.entries(horarios).map(([id, h]) => [id, { inicio: horaDeMinutos(h.inicioMin), fin: horaDeMinutos(h.finMin), recortada: h.recortada }]),
  );
}

export function textoRango(horario: Pick<HorarioParada, "inicio" | "fin">): string {
  return `${horario.inicio} – ${horario.fin}`;
}

export function avisoRecortada(etiquetaFranja: string, excesoMin: number): string {
  return `Se pasa ${excesoMin} min del final de ${articuloFranja(etiquetaFranja)}`;
}

// «la mañana», «la tarde»: la etiqueta pública va en minúsculas con
// artículo; «Mañana temprano» -> «la mañana temprano».
function articuloFranja(etiqueta: string): string {
  return `la ${etiqueta.toLowerCase()}`;
}
