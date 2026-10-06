import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  etiquetaEstado,
  formatearRangoViaje,
  ordenarPasados,
  ordenarProximos,
  situacionViaje,
  textoCuentaAtras,
  textoSituacion,
} from "../presentar";

const aISO = (t: number) => new Date(t).toISOString().slice(0, 10);
// Rango 1970..2100 en milisegundos UTC: cubre bisiestos y cambios de año.
const isoArb = fc.integer({ min: 0, max: 4_102_444_800_000 }).map(aISO);
const textoArb = fc.oneof(isoArb, fc.string(), fc.constantFrom("otoño", "2026-13-45", "", "x2026-10-10y"));
const RE_ISO = /\d{4}-\d{2}-\d{2}/;
const RE_ISO_ANCLADO = /^\d{4}-\d{2}-\d{2}$/;

describe("formatearRangoViaje (mv-ac2)", () => {
  it.each([
    ["2026-10-14", "2026-10-20", "14–20 oct 2026"],
    ["2026-09-28", "2026-10-03", "28 sept – 3 oct 2026"],
    ["2025-12-28", "2026-01-03", "28 dic 2025 – 3 ene 2026"],
    ["2026-10-14", null, "14 oct 2026"],
    ["2026-10-14", "2026-10-14", "14 oct 2026"],
    ["otoño", null, "otoño"],
  ])("(%s, %s) -> %s", (inicio, fin, esperado) => {
    expect(formatearRangoViaje(inicio, fin)).toBe(esperado);
  });

  it("invariante: nunca lanza ni deja una fecha AAAA-MM-DD en la salida", () => {
    fc.assert(
      fc.property(textoArb, fc.option(textoArb, { nil: null }), (a, b) => {
        expect(formatearRangoViaje(a, b)).not.toMatch(RE_ISO);
      }),
      { numRuns: 200 },
    );
  });

  it("invariante: contiene el año de la fecha de fin (o de inicio sin fin) con cuatro cifras", () => {
    fc.assert(
      fc.property(isoArb, fc.option(isoArb, { nil: null }), (a, b) => {
        const ref = b ?? a;
        expect(formatearRangoViaje(a, b)).toContain(ref.slice(0, 4));
      }),
      { numRuns: 200 },
    );
  });
});

interface V {
  id: number;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}
const viajeArb = fc.record({
  id: fc.nat(),
  fecha_inicio: fc.option(fc.oneof(isoArb, fc.constantFrom("otoño", "2026-02-31")), { nil: null }),
  fecha_fin: fc.option(fc.oneof(isoArb, fc.constantFrom("verano", "2026-00-10")), { nil: null }),
});
const listaArb = fc.array(viajeArb, { maxLength: 12 }).map((l) => l.map((v, i) => ({ ...v, id: i })));
const valido = (s: string | null) => {
  if (s === null || !RE_ISO_ANCLADO.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && aISO(t) === s;
};

function ids(l: V[]) {
  return l.map((v) => v.id).sort((a, b) => a - b);
}

describe("ordenarProximos / ordenarPasados (mv-ac1)", () => {
  it("invariante: devuelven una permutación de la entrada", () => {
    fc.assert(
      fc.property(listaArb, (l) => {
        expect(ids(ordenarProximos(l))).toEqual(ids(l));
        expect(ids(ordenarPasados(l))).toEqual(ids(l));
      }),
      { numRuns: 100 },
    );
  });

  it("invariante: próximos por inicio ascendente y los no ISO al final", () => {
    fc.assert(
      fc.property(listaArb, (l) => {
        const r = ordenarProximos(l);
        const flags = r.map((v) => valido(v.fecha_inicio));
        const primeroNoValido = flags.indexOf(false);
        if (primeroNoValido >= 0) expect(flags.slice(primeroNoValido).every((f) => !f)).toBe(true);
        for (let i = 1; i < r.length; i++) {
          if (flags[i - 1] && flags[i]) expect(r[i - 1].fecha_inicio! <= r[i].fecha_inicio!).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("invariante: pasados por fin (o inicio) descendente y los no ISO al final", () => {
    const clave = (v: V) => (valido(v.fecha_fin) ? v.fecha_fin : valido(v.fecha_inicio) ? v.fecha_inicio : null);
    fc.assert(
      fc.property(listaArb, (l) => {
        const r = ordenarPasados(l);
        const claves = r.map(clave);
        const primeroNulo = claves.indexOf(null);
        if (primeroNulo >= 0) expect(claves.slice(primeroNulo).every((c) => c === null)).toBe(true);
        for (let i = 1; i < r.length; i++) {
          const a = claves[i - 1];
          const b = claves[i];
          if (a !== null && b !== null) expect(a >= b).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("orden de mv-ac1: Oporto (ayer), Lisboa (+5), Roma (+30); Atenas antes que Sevilla", () => {
    const prox = [
      { id: "Roma", fecha_inicio: "2026-11-05" },
      { id: "Oporto", fecha_inicio: "2026-10-05" },
      { id: "Lisboa", fecha_inicio: "2026-10-11" },
      { id: "Sin", fecha_inicio: null },
    ];
    expect(ordenarProximos(prox).map((v) => v.id)).toEqual(["Oporto", "Lisboa", "Roma", "Sin"]);
    const pas = [
      { id: "Sevilla", fecha_fin: "2026-08-08" },
      { id: "Atenas", fecha_fin: "2026-09-26" },
    ];
    expect(ordenarPasados(pas).map((v) => v.id)).toEqual(["Atenas", "Sevilla"]);
  });
});

describe("situacionViaje (mv-ac4)", () => {
  it("día N de M y cuenta atrás", () => {
    expect(situacionViaje("2026-10-05", "2026-10-08", "2026-10-06")).toEqual({ tipo: "en-curso", dia: 2, total: 4 });
    expect(textoSituacion(situacionViaje("2026-10-05", "2026-10-08", "2026-10-06"))).toBe("En curso · día 2 de 4");
    expect(textoCuentaAtras(1)).toBe("Empieza mañana");
    expect(textoSituacion(situacionViaje("2026-10-11", "2026-10-13", "2026-10-06"))).toBe("Empieza dentro de 5 días");
    expect(textoSituacion(situacionViaje("2026-09-01", "2026-09-03", "2026-10-06"))).toBeNull();
    expect(situacionViaje("otoño", null, "2026-10-06")).toEqual({ tipo: "sin-fechas" });
  });

  it("invariante: en-curso si y solo si inicio ≤ hoy ≤ fin, con 1 ≤ dia ≤ total", () => {
    fc.assert(
      fc.property(isoArb, isoArb, isoArb, (a, b, hoy) => {
        const [inicio, fin] = a <= b ? [a, b] : [b, a];
        const s = situacionViaje(inicio, fin, hoy);
        expect(s.tipo === "en-curso").toBe(inicio <= hoy && hoy <= fin);
        if (s.tipo === "en-curso") {
          const dias = (t: string) => Date.parse(t) / 86_400_000;
          expect(s.dia).toBeGreaterThanOrEqual(1);
          expect(s.dia).toBeLessThanOrEqual(s.total);
          expect(s.total).toBe(dias(fin) - dias(inicio) + 1);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("etiquetaEstado (mv-ac3)", () => {
  it.each(["encolado", "en-curso", "pausado", "fallido", "caducado", "completado", "otro"])("%s", (estado) => {
    const e = etiquetaEstado(estado);
    expect(e).not.toBe(estado);
    expect(e).not.toBe("");
    expect(e).not.toMatch(/en-curso|encolado|completado|caducado/);
  });

  it("encolado dice «Preparando el plan…»", () => {
    expect(etiquetaEstado("encolado")).toBe("Preparando el plan…");
  });

  it("invariante: nunca devuelve el valor de entrada ni una cadena vacía", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom("encolado", "en-curso", "pausado", "fallido", "caducado")), (estado) => {
        const e = etiquetaEstado(estado);
        expect(e).not.toBe("");
        expect(e).not.toBe(estado);
      }),
      { numRuns: 200 },
    );
  });
});
