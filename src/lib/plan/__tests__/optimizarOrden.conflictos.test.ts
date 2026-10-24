import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { optimizarOrdenDia, type ComprobadorOrden, type ParadaOptimizable } from "../optimizarOrden";
import { validarOrden } from "../reordenar";

const FRANJAS = [{ id: "f0" }, { id: "f1" }];
// Línea recta de este a oeste: el recorrido más corto desde `ancla` es por longitud creciente.
const en = (id: string, lon: number, franja = "f0"): ParadaOptimizable => ({ id, franja_id: franja, coordenadas: { lat: 40, lon } });
const ANCLA = { lat: 40, lon: 0 };

// El museo «cierra» si no está entre las dos primeras de la mañana.
const museoTemprano: ComprobadorOrden = (orden) => (orden.findIndex((e) => e.id === "museo") > 1 ? ["museo"] : []);

describe("optimizarOrdenDia con comprobador (ape-ac4)", () => {
  const paradas = [en("museo", 0.04), en("a", 0.01), en("b", 0.02), en("c", 0.03)];

  it("sin comprobador es idéntico al de siempre y deja el museo al final del recorrido corto", () => {
    const r = optimizarOrdenDia([paradas[0], paradas[3], paradas[2], paradas[1]], FRANJAS, ANCLA);
    expect(r.orden.map((e) => e.id)).toEqual(["a", "b", "c", "museo"]);
  });

  it("con comprobador devuelve el más corto que no añade conflictos", () => {
    const entrada = [paradas[0], paradas[3], paradas[2], paradas[1]];
    const r = optimizarOrdenDia(entrada, FRANJAS, ANCLA, museoTemprano);
    expect(museoTemprano(r.orden)).toEqual([]);
    expect(r.mejora).toBe(true);
    expect(r.orden.map((e) => e.id).indexOf("museo")).toBeLessThanOrEqual(1);
    expect(r.kmDespues).toBeLessThanOrEqual(r.kmAntes);
  });

  it("si ninguno mejor evita el conflicto, deja el orden y dice qué quedaría cerrado", () => {
    const entrada = [paradas[0], paradas[1], paradas[2], paradas[3]];
    const r = optimizarOrdenDia(entrada, FRANJAS, ANCLA, (orden) => (orden.map((e) => e.id).join() === "museo,a,b,c" ? [] : ["museo"]));
    expect(r.mejora).toBe(false);
    expect(r.orden.map((e) => e.id)).toEqual(["museo", "a", "b", "c"]);
    expect(r.dejaCerrado).toEqual(["museo"]);
  });

  it("con 9 paradas en una franja usa la DP y rechaza si añade conflictos", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => en(`p${i}`, 0.09 - i * 0.01));
    const r = optimizarOrdenDia(nueve, FRANJAS, ANCLA, (orden) => (orden[0].id === "p0" ? [] : ["p0"]));
    expect(r.mejora).toBe(false);
    expect(r.dejaCerrado).toEqual(["p0"]);
  });
});

describe("invariantes de optimizarOrdenDia con comprobador", () => {
  const punto = fc.record({ lat: fc.double({ min: 37.17, max: 37.215, noNaN: true }), lon: fc.double({ min: -3.59, max: -3.534, noNaN: true }) });
  const entrada = fc.record({
    puntos: fc.array(punto, { minLength: 3, maxLength: 7 }),
    cortes: fc.integer({ min: 0, max: 7 }),
    cerradas: fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
    limite: fc.integer({ min: 0, max: 6 }),
    ancla: fc.option(punto, { nil: null }),
  });

  it("es una permutación válida, no cambia franjas, no añade conflictos y no alarga", () => {
    fc.assert(
      fc.property(entrada, ({ puntos, cortes, cerradas, limite, ancla }) => {
        const paradas: ParadaOptimizable[] = puntos.map((c, i) => ({ id: `p${i}`, franja_id: i < cortes ? "f0" : "f1", coordenadas: c }));
        // Una parada con `cerradas[i]` solo abre si queda en las primeras `limite + 1` posiciones.
        const comprobar: ComprobadorOrden = (orden) => orden.map((e, pos) => ({ e, pos })).filter(({ e, pos }) => cerradas[Number(e.id.slice(1))] && pos > limite).map(({ e }) => e.id);
        const antes = new Set(comprobar(paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }))));
        const r = optimizarOrdenDia(paradas, FRANJAS, ancla, comprobar);
        const base = paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }));
        expect(validarOrden(base, r.orden, FRANJAS)).toEqual({ ok: true });
        for (const id of comprobar(r.orden)) expect(antes.has(id)).toBe(true);
        expect(r.kmDespues).toBeLessThanOrEqual(r.kmAntes + 1e-9);
        for (const e of r.orden) expect(e.franja_id).toBe(paradas.find((p) => p.id === e.id)?.franja_id);
      }),
      { numRuns: 150 },
    );
  });
});
