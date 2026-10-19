import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { MAX_UBICADAS_OPTIMIZAR, optimizarOrdenDia, type ParadaOptimizable } from "../optimizarOrden";
import { FACTOR_CALLE } from "../tramos";

const FRANJAS = [{ id: "f0" }, { id: "f1" }, { id: "f2" }];
type Punto = { lat: number; lon: number };

interface Dia {
  paradas: ParadaOptimizable[];
  ancla: Punto | null;
}

// Caja de 5×5 km aproximada (0,045° de latitud, 0,056° de longitud a 37° N).
const punto = fc.record({ lat: fc.double({ min: 37.17, max: 37.215, noNaN: true }), lon: fc.double({ min: -3.59, max: -3.534, noNaN: true }) });

// Días con 3-6 paradas ubicadas, 0-2 sin ubicar, 1-3 franjas y la secuencia de franjas sin decrecer.
const dia = fc
  .record({
    ubicadas: fc.array(punto, { minLength: 3, maxLength: 6 }),
    sinUbicar: fc.integer({ min: 0, max: 2 }),
    franjas: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 8, maxLength: 8 }),
    huecos: fc.array(fc.nat(), { minLength: 2, maxLength: 2 }),
    ancla: fc.option(punto, { nil: null }),
  })
  .map(({ ubicadas, sinUbicar, franjas, huecos, ancla }): Dia => {
    const paradas: ParadaOptimizable[] = ubicadas.map((c, i) => ({ id: `u${i}`, franja_id: "", coordenadas: c }));
    for (let k = 0; k < sinUbicar; k++) paradas.splice(huecos[k] % (paradas.length + 1), 0, { id: `s${k}`, franja_id: "" });
    const ranks = franjas.slice(0, paradas.length).sort((a, b) => a - b);
    paradas.forEach((p, i) => (p.franja_id = FRANJAS[ranks[i]].id));
    return { paradas, ancla };
  });

const km = (a: Punto, b: Punto) => (distanciaMetros(a, b) * FACTOR_CALLE) / 1000;
const rango = (franjaId: string) => FRANJAS.findIndex((f) => f.id === franjaId);

function coste(secuencia: Punto[], ancla: Punto | null): number {
  let total = ancla && secuencia.length > 0 ? km(ancla, secuencia[0]) : 0;
  for (let i = 1; i < secuencia.length; i++) total += km(secuencia[i - 1], secuencia[i]);
  return total;
}

function permutaciones<T>(lista: T[]): T[][] {
  if (lista.length <= 1) return [lista];
  return lista.flatMap((x, i) => permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [x, ...resto]));
}

// Referencia independiente: todas las permutaciones de las ubicadas con la
// secuencia de franjas sin decrecer (y, sin alojamiento, la primera fija).
function minimoPorFuerzaBruta({ paradas, ancla }: Dia): number {
  const ubicadas = paradas.filter((p) => p.coordenadas);
  let mejor = Infinity;
  for (const perm of permutaciones(ubicadas)) {
    if (!ancla && perm[0] !== ubicadas[0]) continue;
    const ranks = perm.map((p) => rango(p.franja_id));
    if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) continue;
    mejor = Math.min(mejor, coste(perm.map((p) => p.coordenadas as Punto), ancla));
  }
  return mejor;
}

const optimizar = ({ paradas, ancla }: Dia) => optimizarOrdenDia(paradas, FRANJAS, ancla);

describe("optimizarOrdenDia (invariantes, opt-ac2)", () => {
  it("devuelve una permutación de la entrada", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const ids = optimizar(d).orden.map((e) => e.id);
        expect([...ids].sort()).toEqual(d.paradas.map((p) => p.id).sort());
      }),
      { numRuns: 200 },
    );
  });

  it("nunca empeora el coste y coincide con la fuerza bruta", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const r = optimizar(d);
        expect(r.kmDespues).toBeLessThanOrEqual(r.kmAntes + 1e-9);
        expect(Math.abs(r.kmDespues - minimoPorFuerzaBruta(d))).toBeLessThan(1e-6);
      }),
      { numRuns: 200 },
    );
  });

  it("el coste del orden devuelto es el que se calcula a mano sobre él", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const r = optimizar(d);
        const porId = new Map(d.paradas.map((p) => [p.id, p]));
        const puntos = r.orden.map((e) => porId.get(e.id)!.coordenadas).filter((c): c is Punto => c !== undefined);
        expect(Math.abs(coste(puntos, d.ancla) - r.kmDespues)).toBeLessThan(1e-9);
      }),
      { numRuns: 200 },
    );
  });

  it("las sin ubicar conservan su índice y cada parada su franja", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const r = optimizar(d);
        d.paradas.forEach((p, i) => {
          if (!p.coordenadas) expect(r.orden[i].id).toBe(p.id);
        });
        const franjaOriginal = new Map(d.paradas.map((p) => [p.id, p.franja_id]));
        for (const e of r.orden) expect(e.franja_id).toBe(franjaOriginal.get(e.id));
        const ranks = r.orden.map((e) => rango(e.franja_id));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }),
      { numRuns: 200 },
    );
  });

  it("sin alojamiento la primera ubicada no se mueve", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const sin = { ...d, ancla: null };
        const primera = sin.paradas.find((p) => p.coordenadas)!;
        const resultado = optimizar(sin).orden.find((e, i) => sin.paradas[i].coordenadas);
        expect(resultado?.id).toBe(primera.id);
      }),
      { numRuns: 200 },
    );
  });

  it("es idempotente y determinista", () => {
    fc.assert(
      fc.property(dia, (d) => {
        const primera = optimizar(d);
        expect(optimizar(d)).toEqual(primera);
        const porId = new Map(d.paradas.map((p) => [p.id, p]));
        const segunda = optimizar({ ...d, paradas: primera.orden.map((e) => porId.get(e.id)!) });
        expect(segunda.orden).toEqual(primera.orden);
        expect(segunda.mejora).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("9 paradas ubicadas en una franja tardan menos de 50 ms (opt-ac6)", () => {
    const paradas: ParadaOptimizable[] = Array.from({ length: MAX_UBICADAS_OPTIMIZAR }, (_, i) => ({
      id: `p${i}`,
      franja_id: "f0",
      coordenadas: { lat: 37.17 + ((i * 7) % 9) * 0.005, lon: -3.59 + ((i * 4) % 9) * 0.006 },
    }));
    const medidas: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      optimizarOrdenDia(paradas, FRANJAS, { lat: 37.18, lon: -3.58 });
      medidas.push(performance.now() - t0);
    }
    medidas.sort((a, b) => a - b);
    expect(medidas[5]).toBeLessThan(50);
  });
});
