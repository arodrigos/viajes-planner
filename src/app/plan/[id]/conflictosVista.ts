// apertura-conflictos: puente entre lo que recibe el navegador (DiaPublico, sin
// horas de franja) y lo que necesita evaluarDia. Las horas salen de
// `horario.minutos`, que el servidor ya calculó con las mismas funciones.
import type { DiaConflictable, ParadaConflictable } from "@/lib/plan/conflictos";
import { horaDeMinutos } from "@/lib/plan/tiempos";
import type { HorarioForzado } from "@/lib/testing/ganchosUat";
import type { DiaPublico } from "./tiposVista";

export interface DiaParaConflictos {
  dia: DiaConflictable;
  horarios: Record<string, { inicioMin: number; finMin: number }>;
}

// 1440 no cabe en "HH:MM": el fin de franja a medianoche se queda en 23:59.
const hora = (minutos: number) => (minutos >= 1440 ? "23:59" : horaDeMinutos(minutos));

export function diaParaConflictos(dia: DiaPublico, forzados: Readonly<Record<string, HorarioForzado>> = {}): DiaParaConflictos {
  const horarios: DiaParaConflictos["horarios"] = {};
  const ventanas = new Map<string, { desde: number; hasta: number }>();
  const paradas: ParadaConflictable[] = [];
  for (const p of dia.paradas) {
    const m = p.horario?.minutos;
    if (!m) continue;
    horarios[p.id] = { inicioMin: m.inicio, finMin: m.fin };
    if (!ventanas.has(p.franja_id)) ventanas.set(p.franja_id, { desde: m.franjaDesde, hasta: m.franjaHasta });
    const forzado = forzados[p.id];
    const regla = forzado?.opening_hours ?? p.horario?.fuenteOsm?.regla;
    // Sin regla también entra: el cálculo de horas necesita todas las paradas del día.
    paradas.push({
      id: p.id,
      franja_id: p.franja_id,
      duracion_min: p.duracion_min ?? m.fin - m.inicio,
      ...(p.coordenadas ? { coordenadas: p.coordenadas } : {}),
      ...(!regla ? {} : { lugar: { etiquetas: { opening_hours: regla, ...(forzado ? (forzado.check_date ? { check_date_opening_hours: forzado.check_date } : {}) : p.horario?.fuenteOsm?.comprobadoEn ? { check_date_opening_hours: p.horario.fuenteOsm.comprobadoEn } : {}) } } }),
    });
  }
  const franjas = dia.franjas.flatMap((f) => {
    const v = ventanas.get(f.id);
    return v ? [{ id: f.id, etiqueta: f.etiqueta, hora_inicio: hora(v.desde), hora_fin: hora(v.hasta) }] : [];
  });
  return { dia: { fecha: dia.fecha, franjas, paradas }, horarios };
}
