import { urlComoLlegar } from "@/lib/plan/urlComoLlegar";
import type { Tramo } from "@/lib/plan/tramos";
import type { PuntoMapaDia } from "./MapaDia";
import type { DiaPublico } from "./tiposVista";

// map-ac1: numera en el orden real de las franjas del día (mañana antes
// que comida antes que tarde...), no en el orden en que llegaron del
// servidor; solo las paradas resueltas (con coordenadas) entran en el
// mapa, en el enlace de recorrido y en la tarjeta «Ahora».
export function puntosDelDia(dia: DiaPublico): PuntoMapaDia[] {
  const puntos: PuntoMapaDia[] = [];
  let orden = 0;
  for (const franja of dia.franjas) {
    for (const parada of dia.paradas.filter((p) => p.franja_id === franja.id)) {
      if (!parada.coordenadas) continue;
      orden += 1;
      puntos.push({ id: parada.id, orden, nombre: parada.nombre, lat: parada.coordenadas.lat, lon: parada.coordenadas.lon });
    }
  }
  return puntos;
}

// dest-ac2 / hoy-ac1: la siguiente parada sin visitar, en el orden real de
// las franjas -- es la que nombra la tarjeta «Ahora» y donde se centra el
// mapa del día de hoy.
export function siguienteSinVisitar(puntos: PuntoMapaDia[], idsVisitados: ReadonlySet<string>): PuntoMapaDia | null {
  return puntos.find((p) => !idsVisitados.has(p.id)) ?? null;
}

// dest-ac2: «última visitada, o la primera» hasta la siguiente sin visitar.
// Si todo está visitado, o la «última visitada» coincide con la «siguiente»
// (nada visitado y la primera es la siguiente), no hay enlace.
export function calcularComoLlegar(puntos: PuntoMapaDia[], siguiente: PuntoMapaDia | null, idsVisitados: ReadonlySet<string>): string | null {
  if (!siguiente) return null;

  let origen = puntos[0];
  for (const punto of puntos) {
    if (idsVisitados.has(punto.id)) origen = punto;
  }
  if (origen.id === siguiente.id) return null;

  return urlComoLlegar(origen, siguiente);
}

// hoy-ac1: «N de M visitadas». M cuenta todas las paradas del día (también
// las sin ubicar); N solo las que de verdad están en el día, así que
// 0 ≤ N ≤ M siempre.
export function progresoDelDia(dia: DiaPublico): { visitadas: number; total: number } {
  return { visitadas: dia.paradas.filter((p) => p.visitada).length, total: dia.paradas.length };
}

// El tramo ya calculado por el servidor que llega a la siguiente parada, si
// existe (el primero del día no tiene).
export function tramoHastaSiguiente(tramos: readonly Tramo[], siguiente: PuntoMapaDia | null): Tramo | undefined {
  return siguiente ? tramos.find((t) => t.hastaId === siguiente.id) : undefined;
}
