// tramos-dia (tra-ac1..ac3): tipos, umbrales y enlace de los tramos entre
// paradas consecutivas. El cálculo de minutos vive solo en tiempos.ts
// (tiempos-unicos): aquí no se estima nada, para que no haya un segundo modelo.

// Mismo factor que ha usado siempre el paseo del día: una calle real nunca
// es la línea recta entre dos puntos.
export const FACTOR_CALLE = 1.3;

// Umbrales confirmados en el diseño: con niños se camina menos.
export const UMBRAL_A_PIE_FAMILIAR_KM = 1.5;
export const UMBRAL_A_PIE_RESTO_KM = 2.0;

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
  // 'ruta' si los minutos vienen de un proveedor de rutas reales; 'estimacion' si salen de la distancia.
  fuente: "estimacion" | "ruta";
}

export interface OpcionesTramos {
  // criterios.perfil: cualquier valor distinto de 'familiar' (o ausente)
  // usa el umbral no familiar, igual que el resto del paseo.
  perfil: string | null;
  // criterios.transporte del viaje: solo ['coche'] fuerza el coche; con
  // cualquier otro medio (o ninguno) un tramo largo se propone en público.
  transporte?: readonly string[] | null;
  // Rutas reales precalculadas fuera (síncrono a propósito: el cálculo no hace red).
  proveedor?: ProveedorTramos;
}

// null o una excepción significan «sin dato»: se usa la estimación.
export type ProveedorTramos = (origen: PuntoTramo, destino: PuntoTramo, modo: ModoTramo) => { minutos: number } | null;

const TRAVELMODE: Record<ModoTramo, string> = {
  "a-pie": "walking",
  "transporte-publico": "transit",
  coche: "driving",
};

export function umbralAPieKm(perfil: string | null): number {
  return perfil === "familiar" ? UMBRAL_A_PIE_FAMILIAR_KM : UMBRAL_A_PIE_RESTO_KM;
}

export function soloCoche(transporte: readonly string[] | null | undefined): boolean {
  return !!transporte && transporte.length > 0 && transporte.every((m) => m === "coche");
}

export function hrefTramo(origen: PuntoTramo, destino: PuntoTramo, modo: ModoTramo): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lon}&destination=${destino.lat},${destino.lon}&travelmode=${TRAVELMODE[modo]}`;
}

export const ETIQUETA_MODO: Record<ModoTramo, string> = {
  "a-pie": "A pie",
  "transporte-publico": "Transporte público o taxi",
  coche: "En coche",
};
