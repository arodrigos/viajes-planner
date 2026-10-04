import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import type { AnclaAlojamiento, Foto, OrigenAlternativa, Parada, Plan, Procedencia, Recomendacion } from "./tipos";

// Serialización hacia el cliente. hora_inicio/hora_fin son internas (costura
// con VROOM en fase 2) y no se envían nunca: que no se envíen es lo que
// comprueba esquema-plan-ac2, no una convención de nombres.
export interface FranjaPublica {
  id: string;
  etiqueta: string;
}

// alt-ac5: la procedencia y la distancia de una alternativa se derivan al
// serializar, igual que la procedencia de una parada (repositorio.ts) --
// nunca se guardan por duplicado.
export interface AlternativaPublica {
  id?: string;
  nombre: string;
  descripcion: string;
  motivo: string;
  origen?: OrigenAlternativa;
  distancia_m?: number;
  foto?: Foto;
  coordenadas?: { lat: number; lon: number };
  procedencia: Procedencia;
}

export interface ParadaPublica extends Omit<Parada, "alternativas"> {
  alternativas?: AlternativaPublica[];
}

export interface DiaPublico {
  fecha: string;
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
}

export interface PlanPublico {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: DiaPublico[];
  avisos: string[];
  recomendaciones: Recomendacion[];
}

function aAlternativaPublica(parada: Parada, alternativa: NonNullable<Parada["alternativas"]>[number]): AlternativaPublica {
  const procedencia: Procedencia = alternativa.lugar
    ? { fuente: alternativa.lugar.fuente, url: alternativa.lugar.url }
    : { fuente: "propuesto-sin-verificar" };
  return {
    id: alternativa.id,
    nombre: alternativa.nombre,
    descripcion: alternativa.descripcion,
    motivo: alternativa.motivo,
    origen: alternativa.origen,
    ...(parada.coordenadas && alternativa.coordenadas
      ? { distancia_m: Math.round(distanciaMetros(parada.coordenadas, alternativa.coordenadas)) }
      : {}),
    foto: alternativa.foto,
    coordenadas: alternativa.coordenadas,
    procedencia,
  };
}

function aParadaPublica(parada: Parada): ParadaPublica {
  return {
    ...parada,
    alternativas: parada.alternativas?.map((alternativa) => aAlternativaPublica(parada, alternativa)),
  };
}

export function aPlanPublico(plan: Plan): PlanPublico {
  return {
    id: plan.id,
    version: plan.version,
    destino: plan.destino,
    personas: plan.personas,
    dias: plan.dias.map((dia) => ({
      fecha: dia.fecha,
      ancla_alojamiento: dia.ancla_alojamiento,
      franjas: dia.franjas.map((f) => ({ id: f.id, etiqueta: f.etiqueta })),
      paradas: dia.paradas.map(aParadaPublica),
    })),
    avisos: plan.avisos ?? [],
    recomendaciones: plan.recomendaciones ?? [],
  };
}
