// arreglo-un-toque: las operaciones de mover una parada, puras y sin
// dependencias pesadas. Las usan el cliente (para pintar el cambio antes de que
// el servidor confirme y para deshacerlo) y las pruebas de invariantes; el
// servidor hace lo mismo en mover_parada_a_dia.
import type { EntradaOrden } from "./reordenar";

export interface ParadaMovible {
  id: string;
  franja_id: string;
}

export interface DiaMovible {
  fecha: string;
  franjas: readonly { id: string }[];
  paradas: readonly ParadaMovible[];
}

export interface MovimientoDia {
  diaOrigen: number;
  diaDestino: number;
  paradaId: string;
  franjaId: string;
  // Posición (0 = la primera) en el día de destino; sin ella, al final de su franja.
  posicion?: number;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function nombreDiaSemana(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

// «martes 17»: el día de la semana y el del mes, sin depender del huso.
export function etiquetaDiaCorta(fecha: string): string {
  return `${nombreDiaSemana(fecha)} ${Number(fecha.split("-")[2])}`;
}

function indiceFranja(franjas: readonly { id: string }[], id: string): number {
  return franjas.findIndex((f) => f.id === id);
}

// Dónde queda una parada que entra en `franjaId`: detrás de la última del día
// cuya franja no es posterior, que es lo que hace la función SQL.
export function posicionAlFinalDeFranja(dia: DiaMovible, franjaId: string, excluirId: string): number {
  const destino = indiceFranja(dia.franjas, franjaId);
  return dia.paradas.filter((p) => p.id !== excluirId && indiceFranja(dia.franjas, p.franja_id) <= destino).length;
}

export function ordenConParadaEnFranja(dia: DiaMovible, paradaId: string, franjaId: string): EntradaOrden[] {
  const resto = dia.paradas.filter((p) => p.id !== paradaId);
  const posicion = posicionAlFinalDeFranja(dia, franjaId, paradaId);
  const nuevo: EntradaOrden[] = resto.map((p) => ({ id: p.id, franja_id: p.franja_id }));
  nuevo.splice(posicion, 0, { id: paradaId, franja_id: franjaId });
  return nuevo;
}

// Lleva la parada a otro día. Devuelve también el movimiento inverso, que
// deja origen y destino como estaban (mismas paradas, franjas y orden).
export function moverParadaDeDia<D extends DiaMovible>(dias: readonly D[], m: MovimientoDia, alMover: (p: D["paradas"][number]) => D["paradas"][number] = (p) => p): { dias: D[]; inverso: MovimientoDia } | null {
  const origen = dias[m.diaOrigen];
  const destino = dias[m.diaDestino];
  if (!origen || !destino || m.diaOrigen === m.diaDestino) return null;
  const posOrigen = origen.paradas.findIndex((p) => p.id === m.paradaId);
  if (posOrigen < 0 || indiceFranja(destino.franjas, m.franjaId) < 0) return null;
  const parada = origen.paradas[posOrigen];
  const posicion = m.posicion ?? posicionAlFinalDeFranja(destino, m.franjaId, m.paradaId);
  const movida = alMover({ ...parada, franja_id: m.franjaId });
  const paradasDestino = [...destino.paradas];
  paradasDestino.splice(Math.min(posicion, paradasDestino.length), 0, movida);
  const resultado = dias.map((d, i) => {
    if (i === m.diaOrigen) return { ...d, paradas: d.paradas.filter((p) => p.id !== m.paradaId) };
    if (i === m.diaDestino) return { ...d, paradas: paradasDestino };
    return d;
  });
  return {
    dias: resultado,
    inverso: { diaOrigen: m.diaDestino, diaDestino: m.diaOrigen, paradaId: m.paradaId, franjaId: parada.franja_id, posicion: posOrigen },
  };
}
