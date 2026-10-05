// inf-ac1/inf-ac2: lo que dice la lámina, calculado aparte de su dibujo. Los
// totales salen de calcularPresupuesto, la misma función que la vista, así
// que no pueden divergir de ella.
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import { formatearEuros } from "@/lib/presupuesto/texto";
import { calcularRuta, formatearFechaCorta } from "@/lib/etapas/ruta";
import type { Evento } from "@/lib/eventos/tipos";
import type { Dia, Parada, Plan } from "@/lib/plan/tipos";
import type { Punto } from "./proyeccion";

export interface BloqueLamina {
  titulo: string;
  detalle: string;
  paradas: string[];
  punto?: Punto;
}

export interface TotalesLamina {
  dias: number;
  sitios: number;
  km_traslado: number;
  total_eur: number;
  tu_presupuesto_eur?: number;
  texto_presupuesto: string;
}

export interface ModeloInfografia {
  titulo: string;
  subtitulo: string;
  bloques: BloqueLamina[];
  totales: TotalesLamina;
  eventos: string[];
  multiciudad: boolean;
}

const MAX_PARADAS = 2;
const MAX_BLOQUES_UNA_CIUDAD = 7;
const MAX_EVENTOS = 4;

function destacadas(dias: Dia[]): string[] {
  return dias
    .flatMap((d) => d.paradas)
    .sort((a: Parada, b: Parada) => b.prioridad - a.prioridad)
    .slice(0, MAX_PARADAS)
    .map((p) => p.nombre);
}

function textoFechas(plan: Plan): string {
  const fechas = plan.dias.map((d) => d.fecha).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f));
  if (fechas.length === 0) return `${plan.dias.length} días`;
  return `${formatearFechaCorta(fechas[0])} – ${formatearFechaCorta(fechas[fechas.length - 1])} ${fechas[fechas.length - 1].slice(0, 4)}`;
}

function textoEvento(e: Evento): string {
  return `${formatearFechaCorta(e.fecha)} · ${e.nombre}`;
}

export function construirModeloInfografia(plan: Plan, tuPresupuestoEur?: number): ModeloInfografia {
  const presupuesto = calcularPresupuesto(plan);
  const etapas = plan.etapas ?? [];
  const multiciudad = etapas.length > 0;
  const sitios = plan.dias.reduce((s, d) => s + d.paradas.length, 0);
  const km = Math.round((plan.traslados ?? []).reduce((s, t) => s + t.distancia_km, 0));

  let bloques: BloqueLamina[];
  if (multiciudad) {
    const ruta = calcularRuta({ personas: plan.personas, dias: plan.dias, etapas, traslados: plan.traslados });
    bloques = ruta.etapas.map((e, i) => {
      const diasEtapa = plan.dias.slice(e.dia_inicio, e.dia_inicio + e.dias);
      const coords = diasEtapa.flatMap((d) => d.paradas).find((p) => p.coordenadas)?.coordenadas;
      const caja = etapas[i].ciudad.caja;
      return {
        titulo: e.ciudad,
        detalle: `${e.noches} ${e.noches === 1 ? "noche" : "noches"}`,
        paradas: destacadas(diasEtapa),
        punto: caja ? { lat: (caja.minLat + caja.maxLat) / 2, lon: (caja.minLon + caja.maxLon) / 2 } : coords,
      };
    });
  } else {
    bloques = plan.dias.slice(0, MAX_BLOQUES_UNA_CIUDAD).map((d, i) => ({
      titulo: `Día ${i + 1}`,
      detalle: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? formatearFechaCorta(d.fecha) : "",
      paradas: destacadas([d]),
    }));
  }

  const eventos = (plan.eventos?.eventos ?? []).slice(0, MAX_EVENTOS).map(textoEvento);
  const textoPresupuesto =
    tuPresupuestoEur === undefined
      ? `~${formatearEuros(presupuesto.total_eur)} estimados`
      : `~${formatearEuros(presupuesto.total_eur)} de ${formatearEuros(tuPresupuestoEur)}`;

  return {
    titulo: plan.destino,
    subtitulo: `${textoFechas(plan)} · ${plan.personas} ${plan.personas === 1 ? "persona" : "personas"}`,
    bloques,
    totales: {
      dias: plan.dias.length,
      sitios,
      km_traslado: km,
      total_eur: presupuesto.total_eur,
      ...(tuPresupuestoEur !== undefined ? { tu_presupuesto_eur: tuPresupuestoEur } : {}),
      texto_presupuesto: textoPresupuesto,
    },
    eventos,
    multiciudad,
  };
}
