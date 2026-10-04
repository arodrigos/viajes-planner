import { afterEach, describe, expect, it, vi } from "vitest";
import { esFechaDeHoy, fechaDeHoy } from "../fechaHoy";

afterEach(() => {
  vi.useRealTimers();
});

// dest-ac3: "hoy" se calcula con los getters LOCALES de Date, no UTC -- se
// fija un reloj a medianoche UTC para que una zona con offset negativo
// (p. ej. America/) demostraría la diferencia; aquí basta con comprobar
// que la fecha fijada es la que devuelve la función.
describe("fechaDeHoy/esFechaDeHoy (dest-ac3)", () => {
  it("fechaDeHoy devuelve la fecha del reloj del sistema en formato YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0)); // 7 de noviembre de 2026, hora local
    expect(fechaDeHoy()).toBe("2026-11-07");
  });

  it("esFechaDeHoy compara contra la fecha de hoy, no contra otra", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
    expect(esFechaDeHoy("2026-11-07")).toBe(true);
    expect(esFechaDeHoy("2026-11-08")).toBe(false);
  });
});
