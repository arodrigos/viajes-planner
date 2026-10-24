// tiempos-unicos: el ÚNICO cálculo de tiempos entre paradas y de horarios del
// día. El conector, el rango «HH:MM – HH:MM» de la tarjeta, el «sal a las» y
// el .ics beben de aquí, así que la cadena «llegada = fin anterior + tramo»
// es la misma en las cuatro superficies por construcción.
// Puro y sin red: corre igual en servidor y en cliente, y no importa nada
// «server-only».
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { ordenarParadasPorFranja } from "./paseo";
import {
  FACTOR_CALLE,
  hrefTramo,
  soloCoche,
  umbralAPieKm,
  type ModoTramo,
  type OpcionesTramos,
  type PuntoTramo,
  type Tramo,
} from "./tramos";
import type { Dia } from "./tipos";

// Con niños se camina más despacio.
export const VELOCIDAD_A_PIE_FAMILIAR_KMH = 3.5;
export const VELOCIDAD_A_PIE_RESTO_KMH = 4;
// Velocidades y esperas deliberadamente toscas: la interfaz rotula el
// resultado como estimación por distancia.
const VELOCIDAD_TRANSPORTE_KMH = 18.5;
const ESPERA_TRANSPORTE_MIN = 10;
const VELOCIDAD_COCHE_KMH = 25;
const ESPERA_COCHE_MIN = 5;
// Único redondeo del modelo, y a la vez el único colchón: no hay márgenes
// aparte en la salida ni en el horario.
const PASO_MINUTOS = 5;
// Sin coordenadas en alguna de las dos paradas no hay distancia que dividir:
// una cifra fija y visible en vez de fingir precisión.
export const TRAMO_SIN_UBICACION_MIN = 15;

const MINUTOS_DIA = 1440;

export interface HorarioCalculado {
  // Minutos desde la medianoche del día del plan; pueden pasar de 1440.
  inicioMin: number;
  finMin: number;
  recortada: boolean;
  excesoMin: number;
}

export function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// Módulo 24 h: una parada que cruza la medianoche sale a primera hora del día, nunca a las 24 h y pico.
export function horaDeMinutos(minutos: number): string {
  const dentroDelDia = ((minutos % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const h = Math.floor(dentroDelDia / 60);
  const m = dentroDelDia % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function aMultiploDeCinco(minutos: number): number {
  return Math.max(PASO_MINUTOS, Math.ceil(minutos / PASO_MINUTOS) * PASO_MINUTOS);
}

function velocidadAPieKmh(perfil: string | null): number {
  return perfil === "familiar" ? VELOCIDAD_A_PIE_FAMILIAR_KMH : VELOCIDAD_A_PIE_RESTO_KMH;
}

function minutosEstimados(modo: ModoTramo, km: number, perfil: string | null): number {
  if (modo === "a-pie") return aMultiploDeCinco((km / velocidadAPieKmh(perfil)) * 60);
  if (modo === "coche") return aMultiploDeCinco(ESPERA_COCHE_MIN + (km / VELOCIDAD_COCHE_KMH) * 60);
  return aMultiploDeCinco(ESPERA_TRANSPORTE_MIN + (km / VELOCIDAD_TRANSPORTE_KMH) * 60);
}

function minutosDeProveedor(opciones: OpcionesTramos, origen: PuntoTramo, destino: PuntoTramo, modo: ModoTramo): number | null {
  if (!opciones.proveedor) return null;
  try {
    const respuesta = opciones.proveedor(origen, destino, modo);
    return respuesta && Number.isFinite(respuesta.minutos) && respuesta.minutos >= 0 ? respuesta.minutos : null;
  } catch {
    // Un proveedor que falla nunca rompe la página ni el .ics.
    return null;
  }
}

// El umbral se compara contra el km YA redondeado a una cifra -el que ve el
// usuario-, para que «1,5 km» nunca se rotule como transporte.
export function estimarTramo(origen: PuntoTramo, destino: PuntoTramo, opciones: OpcionesTramos): Tramo {
  const lineaRecta = distanciaMetros({ lat: origen.lat, lon: origen.lon }, { lat: destino.lat, lon: destino.lon }) / 1000;
  const km = Math.round(lineaRecta * FACTOR_CALLE * 10) / 10;
  const modoLargo: ModoTramo = soloCoche(opciones.transporte) ? "coche" : "transporte-publico";
  const modo: ModoTramo = km <= umbralAPieKm(opciones.perfil) ? "a-pie" : modoLargo;
  const deRuta = minutosDeProveedor(opciones, origen, destino, modo);
  return {
    desdeId: origen.id,
    hastaId: destino.id,
    km,
    modo,
    minutos: aMultiploDeCinco(deRuta ?? minutosEstimados(modo, km, opciones.perfil)),
    href: hrefTramo(origen, destino, modo),
    fuente: deRuta === null ? "estimacion" : "ruta",
  };
}

export function calcularTiemposDia(
  dia: Pick<Dia, "franjas" | "paradas">,
  opciones: OpcionesTramos,
): { tramos: Tramo[]; horarios: Record<string, HorarioCalculado> } {
  const ordenadas = ordenarParadasPorFranja(dia.franjas, dia.paradas);
  const franjaPorId = new Map(dia.franjas.map((f) => [f.id, f]));
  const tramos: Tramo[] = [];
  const horarios: Record<string, HorarioCalculado> = {};

  let finAnterior = 0;
  ordenadas.forEach((parada, i) => {
    const franja = franjaPorId.get(parada.franja_id);
    if (!franja) return;
    const anterior = i > 0 ? ordenadas[i - 1] : undefined;

    let llegada = 0;
    if (anterior) {
      let entre = TRAMO_SIN_UBICACION_MIN;
      if (anterior.coordenadas && parada.coordenadas) {
        const tramo = estimarTramo(
          { id: anterior.id, lat: anterior.coordenadas.lat, lon: anterior.coordenadas.lon },
          { id: parada.id, lat: parada.coordenadas.lat, lon: parada.coordenadas.lon },
          opciones,
        );
        tramos.push(tramo);
        entre = tramo.minutos;
      }
      llegada = finAnterior + entre;
    }

    // La cadena continúa entre franjas: la hora de inicio de la franja es un
    // suelo, no un reinicio.
    const primeraDeFranja = !anterior || anterior.franja_id !== parada.franja_id;
    const inicioMin = primeraDeFranja ? Math.max(minutosDeHora(franja.hora_inicio), llegada) : llegada;
    const finMin = inicioMin + parada.duracion_min;
    const excesoMin = Math.max(0, finMin - minutosDeHora(franja.hora_fin));
    horarios[parada.id] = { inicioMin, finMin, recortada: excesoMin > 0, excesoMin };
    finAnterior = finMin;
  });

  return { tramos, horarios };
}
