import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { esViajePasado, hoyLocalISO } from "../clasificar";

describe("esViajePasado", () => {
  it("un viaje que acabó ayer es pasado", () => {
    expect(esViajePasado("2026-10-05", "2026-10-06")).toBe(true);
  });

  it("un viaje que acaba hoy o mañana está en curso, no es pasado", () => {
    expect(esViajePasado("2026-10-06", "2026-10-06")).toBe(false);
    expect(esViajePasado("2026-10-07", "2026-10-06")).toBe(false);
  });

  it("sin fecha de fin (solo época) nunca es pasado", () => {
    expect(esViajePasado(null, "2026-10-06")).toBe(false);
  });

  it("cruza el cambio de mes y de año", () => {
    expect(esViajePasado("2026-09-30", "2026-10-01")).toBe(true);
    expect(esViajePasado("2025-12-31", "2026-01-01")).toBe(true);
  });
});

describe("hoyLocalISO", () => {
  it("rellena mes y día con ceros", () => {
    expect(hoyLocalISO(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("para cualquier día, el resultado es una fecha ISO y ordena como el calendario", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1), noInvalidDate: true }), (d) => {
        const iso = hoyLocalISO(d);
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const mañana = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        expect(hoyLocalISO(mañana) > iso).toBe(true);
      }),
    );
  });
});
