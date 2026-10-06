// etv-ac1: modelo de lo que pinta «Ruta del viaje». Puro: los importes salen
// de las mismas funciones que calcularPresupuesto, así que la suma visible y
// el total no pueden divergir.
import { formatearEuros } from "@/lib/formato/numeros";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import type { CosteParada, Dia, EtapaPlan, TrasladoPlan } from "@/lib/plan/tipos";
import { nochesDeEtapa } from "./validar";

export interface EtapaRuta {
  indice: number;
  ciudad: string;
  pais: string;
  noches: number;
  dias: number;
  dia_inicio: number;
  fecha_inicio?: string;
  fecha_fin?: string;
  motivo?: string;
  ajustes: string[];
  alojamiento_eur: number;
  visitas_eur: number;
  // alojamiento + visitas de la etapa; el traslado de llegada va en el suyo.
  subtotal_eur: number;
  traslado_entrada?: TrasladoPlan;
  // Primer día de la etapa de destino: la fecha de la búsqueda de transporte.
  fecha_llegada?: string;
}

export interface RutaViaje {
  etapas: EtapaRuta[];
  traslados_eur: number;
  // Suma de lo que se pinta (subtotales + traslados); tiene que coincidir con
  // el total del presupuesto.
  suma_visible_eur: number;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const aCentimos = (euros: number) => Math.round(euros * 100);

export function formatearDuracion(minutos: number): string {
  const total = Math.round(minutos);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatearFechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const NOMBRE_MODO: Record<TrasladoPlan["modo"], string> = { coche: "coche", avion: "avión", tren: "tren", autobus: "autobús" };

export function textoTraslado(t: TrasladoPlan): string {
  return `${t.desde} → ${t.hasta} · ${NOMBRE_MODO[t.modo]} · ~${formatearDuracion(t.duracion_min)} · ~${formatearEuros(t.coste_eur)} (estimado)`;
}

// Solo lo que la ruta lee del día: sirve igual al Dia del servidor y al DiaPublico del cliente.
export interface DiaConCoste {
  fecha: string;
  paradas: { coste?: CosteParada }[];
}

export function calcularRuta(plan: { personas: number; dias: DiaConCoste[]; etapas: EtapaPlan[]; traslados?: TrasladoPlan[] }): RutaViaje {
  const traslados = plan.traslados ?? [];
  let sumaCentimos = 0;
  const etapas = plan.etapas.map((etapa, indice): EtapaRuta => {
    const diasEtapa = plan.dias.slice(etapa.dia_inicio, etapa.dia_inicio + etapa.dias);
    const noches = nochesDeEtapa(plan.etapas, indice);
    const alojamiento = noches * aCentimos(etapa.alojamiento_noche_eur);
    const visitas = aCentimos(calcularPresupuesto({ personas: plan.personas, dias: diasEtapa as unknown as Dia[] }).actividades_eur);
    sumaCentimos += alojamiento + visitas;
    const fecha = (d?: DiaConCoste) => (d && FECHA_ISO.test(d.fecha) ? d.fecha : undefined);
    return {
      indice,
      ciudad: etapa.ciudad.nombre ?? "",
      pais: etapa.pais,
      noches,
      dias: etapa.dias,
      dia_inicio: etapa.dia_inicio,
      fecha_inicio: fecha(diasEtapa[0]),
      fecha_fin: fecha(diasEtapa[diasEtapa.length - 1]),
      ...(etapa.motivo ? { motivo: etapa.motivo } : {}),
      ajustes: etapa.ajustes,
      alojamiento_eur: alojamiento / 100,
      visitas_eur: visitas / 100,
      subtotal_eur: (alojamiento + visitas) / 100,
      ...(indice > 0 && traslados[indice - 1] ? { traslado_entrada: traslados[indice - 1] } : {}),
      fecha_llegada: fecha(diasEtapa[0]),
    };
  });
  const trasladosCentimos = traslados.reduce((s, t) => s + aCentimos(t.coste_eur), 0);
  return { etapas, traslados_eur: trasladosCentimos / 100, suma_visible_eur: (sumaCentimos + trasladosCentimos) / 100 };
}
