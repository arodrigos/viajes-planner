// tramos-dia (tra-ac1..ac3): medio, tiempo y enlace entre paradas
// consecutivas del mismo día, sin ninguna API de rutas -- todo sale de la
// distancia geodésica por el mismo factor calle/línea recta que el paseo.
// Puro y testeable; el servidor lo calcula en publico.ts y el cliente solo lo pinta.
import { distanciaMetros } from "@/lib/alternativas/equivalencia";

// Mismo factor que ha usado siempre el paseo del día: una calle real nunca
// es la línea recta entre dos puntos.
export const FACTOR_CALLE = 1.3;

// Umbrales confirmados en el diseño: con niños se camina menos.
export const UMBRAL_A_PIE_FAMILIAR_KM = 1.5;
export const UMBRAL_A_PIE_RESTO_KM = 2.0;

// Velocidades y esperas deliberadamente toscas: el texto de la interfaz
// rotula el resultado como estimación por distancia.
const VELOCIDAD_A_PIE_KMH = 4;
const VELOCIDAD_TRANSPORTE_KMH = 18.5;
const ESPERA_TRANSPORTE_MIN = 10;
const VELOCIDAD_COCHE_KMH = 25;
const ESPERA_COCHE_MIN = 5;
const PASO_MINUTOS = 5;

export type ModoTramo = "a-pie" | "transporte-publico" | "coche";

export interface PuntoTramo {
  id: string;
  lat: number;
  lon: number;
}

export interface Tramo {
  desdeId: string;
  hastaId: string;
  km: number;
  modo: ModoTramo;
  minutos: number;
  href: string;
}

export interface OpcionesTramos {
  // criterios.perfil: cualquier valor distinto de 'familiar' (o ausente)
  // usa el umbral no familiar, igual que el resto del paseo.
  perfil: string | null;
  // criterios.transporte del viaje: solo ['coche'] fuerza el coche; con
  // cualquier otro medio (o ninguno) un tramo largo se propone en público.
  transporte?: readonly string[] | null;
}

const TRAVELMODE: Record<ModoTramo, string> = {
  "a-pie": "walking",
  "transporte-publico": "transit",
  coche: "driving",
};

export function umbralAPieKm(perfil: string | null): number {
  return perfil === "familiar" ? UMBRAL_A_PIE_FAMILIAR_KM : UMBRAL_A_PIE_RESTO_KM;
}

function aMultiploDeCinco(minutos: number): number {
  return Math.max(PASO_MINUTOS, Math.ceil(minutos / PASO_MINUTOS) * PASO_MINUTOS);
}

function minutosPara(modo: ModoTramo, km: number): number {
  if (modo === "a-pie") return aMultiploDeCinco((km / VELOCIDAD_A_PIE_KMH) * 60);
  if (modo === "coche") return aMultiploDeCinco(ESPERA_COCHE_MIN + (km / VELOCIDAD_COCHE_KMH) * 60);
  return aMultiploDeCinco(ESPERA_TRANSPORTE_MIN + (km / VELOCIDAD_TRANSPORTE_KMH) * 60);
}

function soloCoche(transporte: readonly string[] | null | undefined): boolean {
  return !!transporte && transporte.length > 0 && transporte.every((m) => m === "coche");
}

export function hrefTramo(origen: PuntoTramo, destino: PuntoTramo, modo: ModoTramo): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}&destination=${destino.lat},${destino.lon}&travelmode=${TRAVELMODE[modo]}`;
}

// El umbral se compara contra el km YA redondeado a una cifra -el que ve
// el usuario-, para que «1,5 km» nunca se rotule como transporte.
export function calcularTramosDia(puntos: readonly PuntoTramo[], opciones: OpcionesTramos): Tramo[] {
  const umbral = umbralAPieKm(opciones.perfil);
  const modoLargo: ModoTramo = soloCoche(opciones.transporte) ? "coche" : "transporte-publico";
  const tramos: Tramo[] = [];
  for (let i = 1; i < puntos.length; i++) {
    const origen = puntos[i - 1];
    const destino = puntos[i];
    const lineaRecta = distanciaMetros({ lat: origen.lat, lon: origen.lon }, { lat: destino.lat, lon: destino.lon }) / 1000;
    const km = Math.round(lineaRecta * FACTOR_CALLE * 10) / 10;
    const modo: ModoTramo = km <= umbral ? "a-pie" : modoLargo;
    tramos.push({ desdeId: origen.id, hastaId: destino.id, km, modo, minutos: minutosPara(modo, km), href: hrefTramo(origen, destino, modo) });
  }
  return tramos;
}

export function formatearMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

export const ETIQUETA_MODO: Record<ModoTramo, string> = {
  "a-pie": "A pie",
  "transporte-publico": "Transporte público o taxi",
  coche: "En coche",
};
