import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { MODOS_TRANSPORTE, type Modo } from "@/lib/criterios/tipos";
import {
  COSTE_AUTOBUS_EUR_KM,
  COSTE_AVION_EUR_KM,
  COSTE_AVION_FIJO_EUR,
  COSTE_COCHE_EUR_KM,
  COSTE_TREN_EUR_KM,
  DISTANCIA_MIN_AVION_KM,
  FACTOR_RUTA_AVION,
  FACTOR_RUTA_TIERRA,
  PERFIL_AUTOBUS,
  PERFIL_AVION,
  PERFIL_COCHE,
  PERFIL_TREN,
  PLAZAS_COCHE,
  TOPE_AVION_MIN,
  TOPE_TIERRA_MIN,
  type PerfilDeModo,
} from "./constantes";

export interface Punto {
  lat: number;
  lon: number;
}

export interface Traslado {
  modo: Modo;
  distancia_km: number;
  duracion_min: number;
  coste_eur: number;
  procedencia: "estimado";
}

export function topeDelModo(modo: Modo): number {
  return modo === "avion" ? TOPE_AVION_MIN : TOPE_TIERRA_MIN;
}

const PERFILES: Record<Modo, PerfilDeModo> = {
  coche: PERFIL_COCHE,
  avion: PERFIL_AVION,
  tren: PERFIL_TREN,
  autobus: PERFIL_AUTOBUS,
};

function costeDe(modo: Modo, rutaKm: number, personas: number): number {
  switch (modo) {
    case "coche":
      return COSTE_COCHE_EUR_KM * rutaKm * Math.ceil(personas / PLAZAS_COCHE);
    case "tren":
      return COSTE_TREN_EUR_KM * rutaKm * personas;
    case "autobus":
      return COSTE_AUTOBUS_EUR_KM * rutaKm * personas;
    case "avion":
      return (COSTE_AVION_FIJO_EUR + COSTE_AVION_EUR_KM * rutaKm) * personas;
  }
}

const aCentimos = (euros: number): number => Math.round(euros * 100) / 100;

// Núcleo común: a partir de una distancia en línea recta elige el medio
// permitido más barato que cabe en su tope. Con `comoCota` ignora el mínimo
// de 400 km del avión: la viabilidad previa trabaja con la distancia MÍNIMA
// entre cajas, y una ciudad real puede estar más lejos que ese mínimo, así
// que descartar el avión por esa distancia sería declarar inviable un viaje
// que sí cabría.
export function estimarPorDistancia(
  kmRectos: number,
  modos: readonly Modo[],
  personas: number,
  comoCota = false,
): Traslado | null {
  const permitidos = modos.length > 0 ? MODOS_TRANSPORTE.filter((m) => modos.includes(m)) : MODOS_TRANSPORTE;
  let mejor: Traslado | null = null;
  for (const modo of permitidos) {
    if (modo === "avion" && !comoCota && kmRectos <= DISTANCIA_MIN_AVION_KM) continue;
    const rutaKm = kmRectos * (modo === "avion" ? FACTOR_RUTA_AVION : FACTOR_RUTA_TIERRA);
    const perfil = PERFILES[modo];
    const duracion = Math.ceil((rutaKm / perfil.velocidad_kmh) * 60 + perfil.fijo_min);
    if (duracion > topeDelModo(modo)) continue;
    const coste = aCentimos(costeDe(modo, rutaKm, personas));
    if (!mejor || coste < mejor.coste_eur) {
      mejor = { modo, distancia_km: Math.round(rutaKm), duracion_min: duracion, coste_eur: coste, procedencia: "estimado" };
    }
  }
  return mejor;
}

// Un tramo entre los puntos de dos ciudades, o ninguno si ningún medio
// permitido cabe en su tope.
export function estimarTraslado(origen: Punto, destino: Punto, modos: readonly Modo[], personas: number): Traslado | null {
  return estimarPorDistancia(distanciaMetros(origen, destino) / 1000, modos, personas);
}
