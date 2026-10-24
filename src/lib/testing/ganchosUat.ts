// Gancho de pruebas del UAT: solo existe con `?pruebas=1` en la URL y solo
// toca el estado del navegador, nunca el servidor ni los datos del plan.
export interface HorarioForzado {
  opening_hours: string;
  check_date?: string;
}

let forzados: Readonly<Record<string, HorarioForzado>> = {};
const oyentes = new Set<() => void>();

// A nivel de módulo (no de componente) para que sobreviva al cambio de día,
// que desmonta el panel.
export function horariosForzados(): Readonly<Record<string, HorarioForzado>> {
  return forzados;
}

export function suscribirHorariosForzados(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function forzarHorarioParada(entrada: { paradaId: string; opening_hours: string; check_date?: string }): void {
  if (typeof entrada?.paradaId !== "string" || typeof entrada.opening_hours !== "string") return;
  forzados = { ...forzados, [entrada.paradaId]: { opening_hours: entrada.opening_hours, ...(entrada.check_date ? { check_date: entrada.check_date } : {}) } };
  for (const oyente of oyentes) oyente();
}

export function reiniciarHorariosForzados(): void {
  forzados = {};
  for (const oyente of oyentes) oyente();
}

type ConDebug = Window & { __debug?: Record<string, unknown> };

export function instalarGanchosUat(ventana: Window = window): void {
  if (new URLSearchParams(ventana.location.search).get("pruebas") !== "1") return;
  const w = ventana as ConDebug;
  w.__debug = { ...w.__debug, forzarHorarioParada };
}
