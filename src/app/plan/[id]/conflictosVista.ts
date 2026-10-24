// apertura-conflictos: puente entre lo que recibe el navegador (DiaPublico, sin
// horas de franja) y lo que necesita evaluarDia. Las horas salen de
// `horario.minutos`, que el servidor ya calculó con las mismas funciones.
import type { DiaConflictable, ParadaConflictable } from "@/lib/plan/conflictos";

export type { ConflictoDia } from "@/lib/plan/conflictos";
import type { AlternativaArreglable, PlanArreglable } from "@/lib/plan/arreglos";
import { horaDeMinutos } from "@/lib/plan/tiempos";
import type { ElementoFijo } from "@/lib/reservas/enElDia";
import type { HorarioForzado } from "@/lib/testing/ganchosUat";
import type { DiaPublico } from "./tiposVista";

export interface DiaParaConflictos {
  dia: DiaConflictable;
  horarios: Record<string, { inicioMin: number; finMin: number }>;
}

// 1440 no cabe en "HH:MM": el fin de franja a medianoche se queda en el último minuto del día.
const hora = (minutos: number) => horaDeMinutos(Math.min(minutos, 1439));

// Las reservas de un día salen de la fecha: así el cálculo no sabe si vienen del
// detalle del dueño o de la proyección mínima del invitado.
export type FijosDeFecha = (fecha: string) => ElementoFijo[];

export function diaParaConflictos(dia: DiaPublico, forzados: Readonly<Record<string, HorarioForzado>> = {}, fijos?: FijosDeFecha): DiaParaConflictos {
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
    // Una franja vacía no tiene paradas de las que sacar la ventana: la trae ella.
    const v = ventanas.get(f.id) ?? (f.ventana ? { desde: f.ventana.desdeMin, hasta: f.ventana.hastaMin } : undefined);
    return v ? [{ id: f.id, etiqueta: f.etiqueta, hora_inicio: hora(v.desde), hora_fin: hora(v.hasta) }] : [];
  });
  const reservas = fijos?.(dia.fecha) ?? [];
  return { dia: { fecha: dia.fecha, franjas, paradas, ...(reservas.length > 0 ? { reservas } : {}) }, horarios };
}

// arreglo-un-toque: todos los días del plan en la forma que necesita
// proponerArreglos, con las alternativas guardadas que se pueden comprobar.
export function diasParaArreglos(dias: readonly DiaPublico[], forzados: Readonly<Record<string, HorarioForzado>> = {}, fijos?: FijosDeFecha): PlanArreglable {
  return {
    dias: dias.map((d) => {
      const { dia } = diaParaConflictos(d, forzados, fijos);
      return {
        ...dia,
        ...(d.etapa !== undefined ? { etapa: d.etapa } : {}),
        paradas: dia.paradas.map((p) => {
          const alternativas = (d.paradas.find((x) => x.id === p.id)?.alternativas ?? []).flatMap((a): AlternativaArreglable[] =>
            a.id && a.fuenteOsm && a.coordenadas && a.duracion_min
              ? [{ id: a.id, nombre: a.nombre, duracion_min: a.duracion_min, coordenadas: a.coordenadas, opening_hours: a.fuenteOsm.regla, ...(a.fuenteOsm.comprobadoEn ? { check_date: a.fuenteOsm.comprobadoEn } : {}) }]
              : [],
          );
          return alternativas.length > 0 ? { ...p, alternativas } : p;
        }),
      };
    }),
  };
}
