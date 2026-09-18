import type { AnclaAlojamiento, Parada, Plan } from "./tipos";

// Serialización hacia el cliente. hora_inicio/hora_fin son internas (costura
// con VROOM en fase 2) y no se envían nunca: que no se envíen es lo que
// comprueba esquema-plan-ac2, no una convención de nombres.
export interface FranjaPublica {
  id: string;
  etiqueta: string;
}

export interface DiaPublico {
  fecha: string;
  ancla_alojamiento?: AnclaAlojamiento;
  franjas: FranjaPublica[];
  paradas: Parada[];
}

export interface PlanPublico {
  id: string;
  version: number;
  destino: string;
  personas: number;
  dias: DiaPublico[];
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
      paradas: dia.paradas,
    })),
  };
}
