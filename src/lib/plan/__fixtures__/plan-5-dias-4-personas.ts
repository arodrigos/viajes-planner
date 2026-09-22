import { franjasComoArray } from "../config-franjas";
import type { Dia, Plan } from "../tipos";

// Fixture de referencia: cinco días en Sevilla para una familia de cuatro.
// Dos paradas por día (mañana y tarde); procedencia siempre
// "propuesto-sin-verificar" porque en fase 1 no hay otro valor posible.
const DESTINO = "Sevilla";

function diaFixture(fecha: string, indice: number): Dia {
  return {
    fecha,
    ancla_alojamiento: {
      tipo: "zona-propuesta",
      centroide: { lat: 37.3891 + indice * 0.001, lon: -5.9845 },
      radio_m: 800,
    },
    franjas: franjasComoArray(DESTINO),
    paradas: [
      {
        id: `parada-${indice}-manana`,
        franja_id: "manana",
        nombre: `Sitio mañana ${indice}`,
        descripcion: `Parada de mañana número ${indice}, sin verificar contra ninguna ficha todavía.`,
        coordenadas: { lat: 37.389, lon: -5.984 },
        duracion_min: 90,
        prioridad: 70,
        procedencia: { fuente: "propuesto-sin-verificar" },
      },
      {
        id: `parada-${indice}-tarde`,
        franja_id: "tarde",
        nombre: `Sitio tarde ${indice}`,
        descripcion: `Parada de tarde número ${indice}, sin verificar contra ninguna ficha todavía.`,
        coordenadas: { lat: 37.386, lon: -5.992 },
        duracion_min: 60,
        prioridad: 50,
        procedencia: { fuente: "propuesto-sin-verificar" },
      },
    ],
  };
}

export const planFixture: Plan = {
  id: "plan-fixture-sevilla-5d",
  version: 1,
  destino: DESTINO,
  personas: 4,
  dias: [
    diaFixture("2026-10-05", 0),
    diaFixture("2026-10-06", 1),
    diaFixture("2026-10-07", 2),
    diaFixture("2026-10-08", 3),
    diaFixture("2026-10-09", 4),
  ],
  // Explícito, no ausente: recuperarPlan siempre devuelve avisos (bloque
  // generacion), y este fixture se compara con toEqual contra lo recuperado.
  avisos: [],
  // Mismo motivo que avisos: recuperarPlan siempre devuelve recomendaciones
  // (bloque recomendaciones-de-sitios), nunca undefined.
  recomendaciones: [],
};
