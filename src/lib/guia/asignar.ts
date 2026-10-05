// guia-abierta: qué ficha de la guía corresponde a qué parada. Una ficha se
// asigna como mucho a una parada, y solo si el nombre se parece (Dice ≥ 0,6)
// o están a 150 m: asignar por menos sería poner el consejo de un sitio en la
// tarjeta de otro.
import distance from "@turf/distance";
import { normalizarNombre, similitudDice } from "@/lib/lugares/normalizar";
import type { FichaGuia } from "./wikitexto";

export const UMBRAL_SIMILITUD = 0.6;
export const RADIO_MAX_M = 150;

export interface ParadaParaAsignar {
  id: string;
  nombre: string;
  coordenadas?: { lat: number; lon: number };
}

function metrosEntre(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return distance([a.lon, a.lat], [b.lon, b.lat], { units: "kilometers" }) * 1000;
}

interface Par {
  paradaId: string;
  indiceFicha: number;
  puntuacion: number;
}

// Voraz por mejor puntuación: el nombre manda sobre la cercanía (un nombre
// casi idéntico gana a un vecino de 100 m), y cada ficha y cada parada se
// usan una sola vez.
export function asignarFichas(fichas: FichaGuia[], paradas: ParadaParaAsignar[]): Map<string, FichaGuia> {
  const pares: Par[] = [];
  fichas.forEach((ficha, indiceFicha) => {
    const nombreFicha = normalizarNombre(ficha.nombre);
    for (const parada of paradas) {
      const similitud = similitudDice(nombreFicha, normalizarNombre(parada.nombre));
      const cerca =
        ficha.lat !== undefined && ficha.lon !== undefined && parada.coordenadas
          ? metrosEntre({ lat: ficha.lat, lon: ficha.lon }, parada.coordenadas) <= RADIO_MAX_M
          : false;
      if (similitud >= UMBRAL_SIMILITUD) pares.push({ paradaId: parada.id, indiceFicha, puntuacion: 1 + similitud });
      else if (cerca) pares.push({ paradaId: parada.id, indiceFicha, puntuacion: similitud });
    }
  });
  pares.sort((a, b) => b.puntuacion - a.puntuacion || a.indiceFicha - b.indiceFicha || a.paradaId.localeCompare(b.paradaId));

  const resultado = new Map<string, FichaGuia>();
  const fichasUsadas = new Set<number>();
  for (const par of pares) {
    if (resultado.has(par.paradaId) || fichasUsadas.has(par.indiceFicha)) continue;
    resultado.set(par.paradaId, fichas[par.indiceFicha]);
    fichasUsadas.add(par.indiceFicha);
  }
  return resultado;
}
