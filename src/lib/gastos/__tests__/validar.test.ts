import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ERRORES_GASTO as E } from "@/lib/textos/gastos";
import { importeACentimos, validarGasto } from "../validar";

const base = { importe_centimos: 2550, categoria: "comida", fecha: "2027-03-06", actualizado_cliente: "2027-01-01T10:00:00.000Z" };

describe("importeACentimos (gas-ac1)", () => {
  it.each([["25,5", 2550], ["25.50", 2550], ["25,50 €", 2550], ["25", 2500], ["1.234,56", 123456], ["1.234", 123400], ["0,01", 1], ["0,5", 50]])("%s → %i", (texto, centimos) => {
    expect(importeACentimos(texto)).toBe(centimos);
  });
  it.each(["", "abc", "1,234,5", "12,345,6", "-3", "1,2,3"])("«%s» no es un importe", (texto) => {
    expect(importeACentimos(texto)).toBeNull();
  });
  it("round-trip: formatear céntimos con coma y volver da lo mismo", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999 }), (c) => {
      expect(importeACentimos(`${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`)).toBe(c);
    }));
  });
});

describe("validarGasto (gas-ac2)", () => {
  it("acepta un gasto válido y limpia el concepto", () => {
    const r = validarGasto({ ...base, concepto: "  Pizza\r\n " });
    expect(r).toMatchObject({ ok: true, gasto: { concepto: "Pizza", importe_centimos: 2550, fecha: "2027-03-06" } });
  });
  it("aplica la regla de día por categoría con su texto", () => {
    expect(validarGasto({ ...base, categoria: "alojamiento" })).toMatchObject({ ok: false, errores: { fecha: E.alojamientoSinDia } });
    expect(validarGasto({ ...base, fecha: null })).toMatchObject({ ok: false, errores: { fecha: E.elegirDia } });
    expect(validarGasto({ ...base, categoria: "transporte", fecha: null }).ok).toBe(true);
    expect(validarGasto({ ...base, categoria: "ocio" })).toMatchObject({ ok: false, errores: { categoria: E.categoria } });
  });
  it("con los días del viaje, una fecha fuera de ellos es la misma «Elige un día válido del viaje»", () => {
    const fechasViaje = ["2027-03-05", "2027-03-06"];
    expect(validarGasto({ ...base, fecha: "2030-01-01" }, { fechasViaje })).toMatchObject({ ok: false, errores: { fecha: E.fecha } });
    expect(validarGasto({ ...base, categoria: "transporte", fecha: "2027-03-07" }, { fechasViaje })).toMatchObject({ ok: false, errores: { fecha: E.fecha } });
    expect(validarGasto(base, { fechasViaje }).ok).toBe(true);
    expect(validarGasto({ ...base, categoria: "transporte", fecha: null }, { fechasViaje }).ok).toBe(true);
  });
  it("rechaza importes fuera de rango", () => {
    for (const importe_centimos of [0, -1, 10_000_001, 1.5, "3"]) expect(validarGasto({ ...base, importe_centimos })).toMatchObject({ ok: false, errores: { importe_centimos: E.importe } });
  });
});

// Modelo en TS de los CHECK de la migración 038.
function aceptaLaBase(g: { importe_centimos: number; categoria: string; fecha: string | null; concepto?: string }): boolean {
  if (g.importe_centimos < 1 || g.importe_centimos > 10_000_000) return false;
  if (!["comida", "entradas", "transporte", "alojamiento"].includes(g.categoria)) return false;
  if (g.concepto !== undefined && Array.from(g.concepto).length > 80) return false;
  if (g.categoria === "alojamiento" && g.fecha !== null) return false;
  if ((g.categoria === "comida" || g.categoria === "entradas") && g.fecha === null) return false;
  return true;
}

describe("validarGasto: invariante frente a los CHECK de la 038", () => {
  it("acepta si y solo si la base lo aceptaría", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 10_000_010 }),
        fc.constantFrom("comida", "entradas", "transporte", "alojamiento", "ocio"),
        fc.option(fc.constant("2027-03-06"), { nil: null }),
        fc.option(fc.string({ maxLength: 100 }).filter((s) => s.trim() === s && !/[\u0000-\u001f\u007f-\u009f]/.test(s) && s !== ""), { nil: undefined }),
        (importe_centimos, categoria, fecha, concepto) => {
          const r = validarGasto({ importe_centimos, categoria, fecha, concepto, actualizado_cliente: "2027-01-01T00:00:00Z" });
          expect(r.ok).toBe(aceptaLaBase({ importe_centimos, categoria, fecha, concepto }));
        },
      ),
    );
  });
});
