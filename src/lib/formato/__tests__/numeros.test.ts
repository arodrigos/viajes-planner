import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatearAnio, formatearEuros, formatearKm, formatearMinutos } from "../numeros";

const NBSP = " ";

describe("formatearEuros (fmt-ac2)", () => {
  it("separa los miles también en cuatro cifras, con espacio duro antes de €", () => {
    expect(formatearEuros(3000)).toBe(`3.000${NBSP}€`);
    expect(formatearEuros(12345)).toBe(`12.345${NBSP}€`);
    expect(formatearEuros(999)).toBe(`999${NBSP}€`);
    expect(formatearEuros(0)).toBe(`0${NBSP}€`);
    expect(formatearEuros(1234567)).toBe(`1.234.567${NBSP}€`);
  });

  it("redondea al entero más cercano", () => {
    expect(formatearEuros(2999.6)).toBe(`3.000${NBSP}€`);
    expect(formatearEuros(12.4)).toBe(`12${NBSP}€`);
  });

  // Invariante 1 de fmt: quitar puntos, espacio duro y € devuelve el entero.
  it("quitando los separadores devuelve el entero (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (n) => {
        const texto = formatearEuros(n);
        expect(texto.replace(/[. €]/g, "")).toBe(String(n));
        expect(texto).not.toMatch(/NaN|undefined/);
      }),
    );
  });

  // Invariante 2 de fmt: punto de miles desde 1000 y grupos de 3 dígitos.
  it("lleva punto de miles desde 1000 y grupos de tres dígitos (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (n) => {
        const cifras = formatearEuros(n).replace(`${NBSP}€`, "");
        if (n < 1000) expect(cifras).not.toContain(".");
        else {
          expect(cifras).toContain(".");
          for (const grupo of cifras.split(".").slice(1)) expect(grupo).toMatch(/^\d{3}$/);
        }
      }),
    );
  });
});

describe("formatearAnio", () => {
  it("nunca agrupa (property, invariante 3)", () => {
    expect(formatearAnio(1857)).toBe("1857");
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (a) => {
        expect(formatearAnio(a)).toBe(String(a));
      }),
    );
  });
});

describe("formatearKm y formatearMinutos", () => {
  it("usa coma decimal y un decimal", () => {
    expect(formatearKm(2.6)).toBe("2,6 km");
    expect(formatearKm(8)).toBe("8,0 km");
    expect(formatearKm(1234.5)).toBe("1.234,5 km");
  });

  it("escribe horas y minutos", () => {
    expect(formatearMinutos(20)).toBe("20 min");
    expect(formatearMinutos(130)).toBe("2 h 10 min");
    expect(formatearMinutos(120)).toBe("2 h");
  });
});
