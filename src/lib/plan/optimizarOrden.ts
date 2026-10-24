// optimizar-orden: recorrido más corto de un día, exacto y sin red. Puro: el
// navegador lo calcula al pulsar y el servidor solo persiste el resultado.
// Mide con la misma distancia que tramos.ts y paseo.ts (línea recta × FACTOR_CALLE).
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import type { EntradaOrden } from "./reordenar";
import { FACTOR_CALLE } from "./tramos";

export const MIN_UBICADAS_OPTIMIZAR = 3;
export const MAX_UBICADAS_OPTIMIZAR = 9;
// Por debajo de esta mejora el cambio no compensa una versión nueva.
export const MEJORA_MINIMA_KM = 0.1;

// Empates de coste dentro de este margen se resuelven por el orden original.
const TOLERANCIA_KM = 1e-9;

export interface ParadaOptimizable extends EntradaOrden {
  coordenadas?: { lat: number; lon: number };
}

export interface ResultadoOptimizar {
  orden: EntradaOrden[];
  kmAntes: number;
  kmDespues: number;
  // El orden devuelto es estrictamente más corto que el de entrada.
  mejora: boolean;
  // Solo con comprobador: paradas que el orden más corto dejaría en conflicto
  // de horario y que hoy no lo están. Se rellena cuando por eso no hay mejora.
  dejaCerrado?: string[];
}

// Ids de las paradas con conflicto de horario en un orden dado. El comprobador
// lo pone quien conoce horarios y franjas; aquí solo se cuenta.
export type ComprobadorOrden = (orden: readonly EntradaOrden[]) => readonly string[];

// Por encima de este número de órdenes válidos se usa la DP y se rechaza su
// resultado si añade conflictos, en vez de enumerar.
export const MAX_ORDENES_ENUMERAR = 40_320;

type Punto = { lat: number; lon: number };

function km(a: Punto, b: Punto): number {
  return (distanciaMetros(a, b) * FACTOR_CALLE) / 1000;
}

// Recorrido: [ancla →] ubicadas en orden, sin redondear.
function costeRecorrido(puntos: readonly Punto[], ancla: Punto | null): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += km(puntos[i - 1], puntos[i]);
  if (ancla && puntos.length > 0) total += km(ancla, puntos[0]);
  return total;
}

export function ubicadasDelDia(paradas: readonly { coordenadas?: unknown }[]): number {
  return paradas.filter((p) => p.coordenadas !== undefined).length;
}

// Opción A (Adrián): las franjas se quedan a su hora. Solo se permutan las
// paradas ubicadas de cada franja; una franja se encadena con la siguiente
// desde su última parada. Las no ubicadas no se mueven de índice. El inicio es
// el alojamiento si tiene coordenadas y, si no, la primera parada ubicada, que
// tampoco se mueve. Final libre.
export function optimizarOrdenDia(
  paradas: readonly ParadaOptimizable[],
  franjas: readonly { id: string }[],
  ancla: Punto | null,
  comprobar?: ComprobadorOrden,
): ResultadoOptimizar {
  const sinConflictos = optimizarPorDistancia(paradas, franjas, ancla);
  if (!comprobar) return sinConflictos;
  return respetandoHorarios(paradas, franjas, ancla, comprobar, sinConflictos);
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// Elige el orden más corto que no añade conflictos de horario respecto al de
// entrada. Si el más corto de todos ya cumple, es ese (la DP es exacta).
function respetandoHorarios(
  paradas: readonly ParadaOptimizable[],
  franjas: readonly { id: string }[],
  ancla: Punto | null,
  comprobar: ComprobadorOrden,
  optimo: ResultadoOptimizar,
): ResultadoOptimizar {
  if (!optimo.mejora) return optimo;
  const entrada = paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }));
  const enConflictoAntes = new Set(comprobar(entrada));
  const nuevos = (orden: readonly EntradaOrden[]): string[] => comprobar(orden).filter((id) => !enConflictoAntes.has(id));
  const valido = (orden: readonly EntradaOrden[]): boolean => nuevos(orden).length === 0;

  if (valido(optimo.orden)) return optimo;
  const rechazado = nuevos(optimo.orden);
  const sinCambios: ResultadoOptimizar = { orden: entrada, kmAntes: optimo.kmAntes, kmDespues: optimo.kmAntes, mejora: false };

  // Se enumera solo si el número de órdenes válidos cabe: producto de los
  // factoriales de las ubicadas de cada franja (el primero queda fijo sin ancla).
  const indices: number[] = [];
  paradas.forEach((p, i) => {
    if (p.coordenadas) indices.push(i);
  });
  const rango = indices.map((i) => franjas.findIndex((f) => f.id === paradas[i].franja_id));
  const porFranja = new Map<number, number>();
  rango.forEach((r) => porFranja.set(r, (porFranja.get(r) ?? 0) + 1));
  let ordenes = 1;
  for (const [r, cuantas] of porFranja) {
    const libres = !ancla && r === rango[0] ? cuantas - 1 : cuantas;
    ordenes *= factorial(libres);
    if (ordenes > MAX_ORDENES_ENUMERAR) break;
  }
  if (ordenes > MAX_ORDENES_ENUMERAR) return { ...sinCambios, ...(rechazado.length > 0 ? { dejaCerrado: rechazado } : {}) };

  const puntos = indices.map((i) => paradas[i].coordenadas as Punto);
  const n = indices.length;
  const todos = (1 << n) - 1;
  let mejorKm = optimo.kmAntes;
  let mejorSecuencia: number[] | null = null;
  const secuencia: number[] = [];

  const aOrden = (sec: readonly number[]): EntradaOrden[] => {
    const orden = paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }));
    sec.forEach((j, posicion) => {
      orden[indices[posicion]] = { id: paradas[indices[j]].id, franja_id: paradas[indices[j]].franja_id };
    });
    return orden;
  };

  // Ramifica en orden de índice original (empates por el orden original) y
  // poda por kilómetros antes de pagar el comprobador.
  const visitar = (mascara: number, ultimo: number, acumulado: number): void => {
    if (acumulado >= mejorKm - TOLERANCIA_KM) return;
    if (mascara === todos) {
      if (valido(aOrden(secuencia))) {
        mejorKm = acumulado;
        mejorSecuencia = [...secuencia];
      }
      return;
    }
    let minimo = Infinity;
    for (let j = 0; j < n; j++) if (!(mascara & (1 << j)) && rango[j] < minimo) minimo = rango[j];
    for (let j = 0; j < n; j++) {
      if (mascara & (1 << j) || rango[j] !== minimo) continue;
      const paso = secuencia.length === 0 ? (ancla ? km(ancla, puntos[j]) : 0) : km(puntos[ultimo], puntos[j]);
      secuencia.push(j);
      visitar(mascara | (1 << j), j, acumulado + paso);
      secuencia.pop();
    }
  };
  if (ancla) visitar(0, -1, 0);
  else {
    secuencia.push(0);
    visitar(1, 0, 0);
  }

  if (mejorSecuencia === null) return { ...sinCambios, ...(rechazado.length > 0 ? { dejaCerrado: rechazado } : {}) };
  return { orden: aOrden(mejorSecuencia), kmAntes: optimo.kmAntes, kmDespues: mejorKm, mejora: true };
}

function optimizarPorDistancia(
  paradas: readonly ParadaOptimizable[],
  franjas: readonly { id: string }[],
  ancla: Punto | null,
): ResultadoOptimizar {
  const entrada: EntradaOrden[] = paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }));
  const indices: number[] = [];
  paradas.forEach((p, i) => {
    if (p.coordenadas) indices.push(i);
  });
  const n = indices.length;
  const puntos = indices.map((i) => paradas[i].coordenadas as Punto);
  const kmAntes = costeRecorrido(puntos, ancla);
  const sinCambios: ResultadoOptimizar = { orden: entrada, kmAntes, kmDespues: kmAntes, mejora: false };
  // Más de 9 es 2^n estados: la interfaz lo desactiva, aquí no se intenta.
  if (n < 2 || n > MAX_UBICADAS_OPTIMIZAR) return sinCambios;

  const rango = indices.map((i) => franjas.findIndex((f) => f.id === paradas[i].franja_id));
  // Matriz de distancias; el nodo n es el alojamiento.
  const nodos: Punto[] = ancla ? [...puntos, ancla] : puntos;
  const d = nodos.map((a) => nodos.map((b) => km(a, b)));

  const todos = (1 << n) - 1;
  // Solo se puede visitar una parada si ninguna de una franja anterior queda sin visitar.
  const permitidas = (visitadas: number): number[] => {
    let minimo = Infinity;
    for (let j = 0; j < n; j++) if (!(visitadas & (1 << j)) && rango[j] < minimo) minimo = rango[j];
    const salida: number[] = [];
    for (let j = 0; j < n; j++) if (!(visitadas & (1 << j)) && rango[j] === minimo) salida.push(j);
    return salida;
  };

  // restante[mascara][ultimo]: coste mínimo de visitar lo que falta partiendo de `ultimo`.
  const restante = new Map<number, number>();
  const clave = (mascara: number, ultimo: number) => mascara * (n + 1) + ultimo;
  const resolver = (mascara: number, ultimo: number): number => {
    if (mascara === todos) return 0;
    const guardado = restante.get(clave(mascara, ultimo));
    if (guardado !== undefined) return guardado;
    let mejor = Infinity;
    for (const j of permitidas(mascara)) mejor = Math.min(mejor, d[ultimo][j] + resolver(mascara | (1 << j), j));
    restante.set(clave(mascara, ultimo), mejor);
    return mejor;
  };

  const secuencia: number[] = [];
  let mascara = 0;
  let ultimo = n; // sin alojamiento no se usa: el primero queda fijo abajo
  if (!ancla) {
    secuencia.push(0);
    mascara = 1;
    ultimo = 0;
  }
  while (mascara !== todos) {
    const objetivo = resolver(mascara, ultimo);
    // El primero por índice original entre los que siguen siendo óptimos.
    const siguiente = permitidas(mascara).find((j) => d[ultimo][j] + resolver(mascara | (1 << j), j) <= objetivo + TOLERANCIA_KM);
    if (siguiente === undefined) return sinCambios;
    secuencia.push(siguiente);
    mascara |= 1 << siguiente;
    ultimo = siguiente;
  }

  const kmDespues = costeRecorrido(secuencia.map((j) => puntos[j]), ancla);
  // Sin mejora real el orden se queda como está, aunque un empate dentro de la tolerancia lo hubiera movido.
  if (kmAntes - kmDespues <= TOLERANCIA_KM) return { ...sinCambios, kmDespues: Math.min(kmAntes, kmDespues) };

  // Cada ubicada ocupa el hueco ubicado que le toca; las demás no se tocan.
  const orden = entrada.map((e) => ({ ...e }));
  secuencia.forEach((j, posicion) => {
    orden[indices[posicion]] = { ...entrada[indices[j]] };
  });
  return { orden, kmAntes, kmDespues, mejora: true };
}
