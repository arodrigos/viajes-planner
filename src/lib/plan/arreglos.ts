// arreglo-un-toque: opciones para una parada en conflicto de horario. Puro: cada
// opción se comprueba aplicándola al día resultante y volviendo a detectar
// conflictos, así que una propuesta nunca crea otro conflicto. Nunca propone
// quitar la parada.
import { nombreDiaSemana, ordenConParadaEnFranja, type DiaMovible } from "./aplicarArreglo";
import { evaluarApertura, evaluarDia, type ConflictoDia, type ContextoConflictos, type DiaConflictable, type EvaluacionDia, type ParadaConflictable } from "./conflictos";
import { calcularTiemposDia, horaDeMinutos } from "./tiempos";
import type { ElementoFijo } from "@/lib/reservas/enElDia";
import { TEXTOS_ARREGLOS } from "@/lib/textos/arreglos";

export type ArregloPropuesto =
  | { tipo: "otra-franja"; diaIndex: number; franjaId: string; etiqueta: string }
  | { tipo: "otro-dia"; diaDestino: number; franjaId: string; etiqueta: string }
  | { tipo: "alternativa"; alternativaId: string; etiqueta: string };

export interface AlternativaArreglable {
  id: string;
  nombre: string;
  duracion_min: number;
  coordenadas?: { lat: number; lon: number };
  opening_hours?: string;
  check_date?: string;
}

export interface ParadaArreglable extends ParadaConflictable {
  alternativas?: AlternativaArreglable[];
}

export interface DiaArreglable extends DiaMovible {
  franjas: DiaConflictable["franjas"];
  // En un viaje de varias ciudades una parada no cruza de etapa.
  etapa?: number;
  paradas: ParadaArreglable[];
  // Reservas con hora de ese día: cada opción se comprueba también contra ellas.
  reservas?: ElementoFijo[];
}

export interface PlanArreglable {
  dias: DiaArreglable[];
}

const MAXIMO_OPCIONES = 3;

function conArticulo(etiqueta: string): string {
  return `la ${etiqueta.toLowerCase()}`;
}

function rellenar(plantilla: string, valores: Record<string, string>): string {
  return Object.entries(valores).reduce((texto, [clave, valor]) => texto.replace(`{${clave}}`, valor), plantilla);
}

// Una parada nueva en el día no puede añadir conflictos a las demás ni tener el suyo.
function sinEmpeorar(antes: EvaluacionDia, despues: EvaluacionDia, paradaId: string, exigirHorarioConocido: boolean): boolean {
  if (despues.conflictos.some((c) => c.paradaId === paradaId)) return false;
  // Lo desconocido no se vende como «abre»: si no se sabe, no se propone. Si el
  // choque es con una reserva, el horario del sitio no es lo que se arregla.
  if (exigirHorarioConocido && despues.sinConfirmar.includes(paradaId)) return false;
  const previos = new Set(antes.conflictos.map((c) => c.paradaId));
  return despues.conflictos.every((c) => previos.has(c.paradaId));
}

// Pasarse del final de la franja no cuenta como conflicto (la tarjeta solo
// avisa de que va recortada), pero un arreglo que deja la visita a medias en
// otra franja no arregla nada: solo se propone lo que cabe entero. Ninguna
// opción recorta la duración, porque la duración no la decide el arreglo.
function cabeEnSuFranja(dia: DiaArreglable, paradaId: string, contexto: ContextoConflictos): boolean {
  const horario = calcularTiemposDia(dia as unknown as Parameters<typeof calcularTiemposDia>[0], contexto.opciones).horarios[paradaId];
  return horario !== undefined && horario.excesoMin === 0;
}

// De la apertura del día entero sale el motivo que ve la persona: abre de X a Y.
function motivoApertura(regla: string, checkDate: string | undefined, fecha: string, parada: { lat: number; lon: number }, contexto: ContextoConflictos): string | null {
  const dia = evaluarApertura({
    opening_hours: regla,
    check_date: checkDate,
    fecha,
    desdeMin: 0,
    hastaMin: 1440,
    duracionMin: 1,
    lugar: { ...parada, ...(contexto.countryCode ? { country_code: contexto.countryCode } : {}) },
  });
  const primero = dia.intervalos[0];
  const ultimo = dia.intervalos[dia.intervalos.length - 1];
  if (dia.estado !== "abierto" || !primero) return null;
  return rellenar(TEXTOS_ARREGLOS.abre.texto, { abre: horaDeMinutos(primero.desdeMin), cierra: horaDeMinutos(Math.min(ultimo.hastaMin, 1439)) });
}

function conParadaEn(dia: DiaArreglable, orden: { id: string; franja_id: string }[], reemplazos: Record<string, ParadaArreglable> = {}): DiaArreglable {
  const porId = new Map(dia.paradas.map((p) => [p.id, p]));
  return {
    ...dia,
    paradas: orden.flatMap((e) => {
      const p = reemplazos[e.id] ?? porId.get(e.id);
      return p ? [{ ...p, franja_id: e.franja_id }] : [];
    }),
  };
}

export function proponerArreglos(plan: PlanArreglable, diaIndex: number, conflicto: ConflictoDia, contexto: ContextoConflictos): ArregloPropuesto[] {
  const dia = plan.dias[diaIndex];
  const parada = dia?.paradas.find((p) => p.id === conflicto.paradaId);
  const regla = parada?.lugar?.etiquetas.opening_hours;
  const deReserva = conflicto.clase === "solapa-reserva" || conflicto.clase === "antes-de-llegada" || conflicto.clase === "despues-de-salida";
  if (!dia || !parada || (!deReserva && (!regla || !parada.coordenadas))) return [];
  const exigirHorario = !deReserva;
  const contextoPuro: ContextoConflictos = { opciones: contexto.opciones, ...(contexto.countryCode ? { countryCode: contexto.countryCode } : {}) };
  const opciones: ArregloPropuesto[] = [];
  // Con un sitio sin horario conocido (choque con una reserva) el motivo es la reserva, no la apertura.
  const motivo = (fecha: string) => (regla && parada.coordenadas ? motivoApertura(regla, parada.lugar?.etiquetas.check_date_opening_hours, fecha, parada.coordenadas, contexto) : TEXTOS_ARREGLOS.sinChoques.texto);
  const indiceActual = dia.franjas.findIndex((f) => f.id === parada.franja_id);

  // Primero las franjas más cercanas a la actual; a igual distancia, la posterior.
  const porCercania = <T extends { id: string }>(franjas: readonly T[], desde: number) =>
    franjas.map((f, i) => ({ f, i })).sort((a, b) => Math.abs(a.i - desde) - Math.abs(b.i - desde) || b.i - a.i);

  // 1) Otra franja del mismo día.
  const antesDia = evaluarDia(dia, contextoPuro);
  for (const { f } of porCercania(dia.franjas, indiceActual)) {
    if (f.id === parada.franja_id) continue;
    const candidato = conParadaEn(dia, ordenConParadaEnFranja(dia, parada.id, f.id));
    if (!sinEmpeorar(antesDia, evaluarDia(candidato, contextoPuro), parada.id, exigirHorario) || !cabeEnSuFranja(candidato, parada.id, contextoPuro)) continue;
    const porQue = motivo(dia.fecha);
    if (!porQue) continue;
    opciones.push({ tipo: "otra-franja", diaIndex, franjaId: f.id, etiqueta: rellenar(TEXTOS_ARREGLOS.pasarA.texto, { franja: conArticulo(f.etiqueta), motivo: porQue }) });
    break;
  }

  // 2) El día más cercano del viaje, en la misma franja o en otra.
  const dias = plan.dias.map((d, i) => ({ d, i })).filter(({ d, i }) => i !== diaIndex && d.etapa === dia.etapa);
  dias.sort((a, b) => Math.abs(a.i - diaIndex) - Math.abs(b.i - diaIndex) || a.i - b.i);
  buscarDia: for (const { d, i } of dias) {
    const antes = evaluarDia(d, contextoPuro);
    const mismaFranja = d.franjas.findIndex((f) => f.id === parada.franja_id);
    const candidatas = mismaFranja >= 0 ? porCercania(d.franjas, mismaFranja) : porCercania(d.franjas, Math.min(indiceActual, d.franjas.length - 1));
    for (const { f } of candidatas) {
      const trasladada: ParadaArreglable = { ...parada, franja_id: f.id };
      const orden = ordenConParadaEnFranja({ ...d, paradas: [...d.paradas, trasladada] }, parada.id, f.id);
      const candidato = conParadaEn({ ...d, paradas: [...d.paradas, trasladada] }, orden);
      if (!sinEmpeorar(antes, evaluarDia(candidato, contextoPuro), parada.id, exigirHorario) || !cabeEnSuFranja(candidato, parada.id, contextoPuro)) continue;
      const porQue = motivo(d.fecha);
      if (!porQue) continue;
      const etiqueta =
        f.id === parada.franja_id
          ? rellenar(TEXTOS_ARREGLOS.llevarAl.texto, { dia: nombreDiaSemana(d.fecha), motivo: porQue })
          : rellenar(TEXTOS_ARREGLOS.llevarAlPor.texto, { dia: nombreDiaSemana(d.fecha), franja: conArticulo(f.etiqueta), motivo: porQue });
      opciones.push({ tipo: "otro-dia", diaDestino: i, franjaId: f.id, etiqueta });
      break buscarDia;
    }
  }

  // 3) Una alternativa guardada que esté abierta en esa franja.
  for (const alternativa of parada.alternativas ?? []) {
    if (!alternativa.opening_hours || !alternativa.coordenadas) continue;
    const sustituta: ParadaArreglable = {
      ...parada,
      duracion_min: alternativa.duracion_min,
      coordenadas: alternativa.coordenadas,
      lugar: { etiquetas: { opening_hours: alternativa.opening_hours, ...(alternativa.check_date ? { check_date_opening_hours: alternativa.check_date } : {}) } },
    };
    const candidato = { ...dia, paradas: dia.paradas.map((p) => (p.id === parada.id ? sustituta : p)) };
    if (!sinEmpeorar(antesDia, evaluarDia(candidato, contextoPuro), parada.id, exigirHorario) || !cabeEnSuFranja(candidato, parada.id, contextoPuro)) continue;
    const porQue = motivoApertura(alternativa.opening_hours, alternativa.check_date, dia.fecha, alternativa.coordenadas, contexto);
    if (!porQue) continue;
    opciones.push({ tipo: "alternativa", alternativaId: alternativa.id, etiqueta: rellenar(TEXTOS_ARREGLOS.cambiarPor.texto, { nombre: alternativa.nombre, motivo: porQue }) });
    break;
  }

  return opciones.slice(0, MAXIMO_OPCIONES);
}

