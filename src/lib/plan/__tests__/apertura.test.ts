import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluarApertura, type EntradaApertura } from "../apertura";

const ROMA = { lat: 41.9, lon: 12.5 };
const base = (extra: Partial<EntradaApertura>): EntradaApertura => ({
  opening_hours: "Mo off; Tu-Su 10:00-18:00",
  fecha: "2026-11-17",
  desdeMin: 540,
  hastaMin: 780,
  duracionMin: 90,
  lugar: { ...ROMA, country_code: "it" },
  ...extra,
});

describe("evaluarApertura (ape-ac1, ape-ac2)", () => {
  it("lunes cerrado, martes abierto aunque abra después del inicio de la franja", () => {
    expect(evaluarApertura(base({ fecha: "2026-11-16" })).estado).toBe("cerrado");
    const martes = evaluarApertura(base({}));
    expect(martes.estado).toBe("abierto");
    expect(martes.intervalos).toEqual([{ desdeMin: 600, hastaMin: 780 }]);
  });

  it("lo que no se puede evaluar es desconocido, con su motivo", () => {
    expect(evaluarApertura(base({ opening_hours: undefined }))).toMatchObject({ estado: "desconocido", motivoDesconocido: "sin-horario" });
    expect(evaluarApertura(base({ opening_hours: "abc" }))).toMatchObject({ estado: "desconocido", motivoDesconocido: "regla-no-evaluable" });
    expect(evaluarApertura(base({ opening_hours: 'Mo-Su 10:00-18:00 "por cita"' })).estado).toBe("desconocido");
  });

  it("PH sin país es desconocido; con país se aplica el festivo", () => {
    const regla = { opening_hours: "Mo-Su 10:00-18:00; PH off", fecha: "2026-12-08", desdeMin: 600, hastaMin: 900 };
    expect(evaluarApertura(base({ ...regla, lugar: ROMA }))).toMatchObject({ estado: "desconocido", motivoDesconocido: "sin-festivos" });
    expect(evaluarApertura(base(regla)).estado).toBe("cerrado");
    expect(evaluarApertura(base({ ...regla, fecha: "2026-12-09" })).estado).toBe("abierto");
  });

  it("lleva la fecha de comprobación y la fuente", () => {
    expect(evaluarApertura(base({ check_date: "2024-05" }))).toMatchObject({ fuente: "osm", comprobado: "2024-05" });
  });

  it("una visita más larga que la ventana se mide contra la ventana", () => {
    expect(evaluarApertura(base({ duracionMin: 600, desdeMin: 600, hastaMin: 780 })).estado).toBe("abierto");
  });
});

describe("invariantes de evaluarApertura", () => {
  const entradas = fc.record({
    opening_hours: fc.oneof(
      fc.constantFrom("Mo off; Tu-Su 10:00-18:00", "Mo-Su 09:00-13:00,16:00-20:00", "24/7", "Mo-Fr 08:00-12:00", 'Mo-Su 10:00-18:00 "por cita"', "abc", "", "Su off"),
      fc.string({ maxLength: 30 }),
    ),
    fecha: fc.integer({ min: 0, max: 400 }).map((d) => new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)),
    desdeMin: fc.integer({ min: 0, max: 1200 }),
    largo: fc.integer({ min: 30, max: 600 }),
    duracionMin: fc.integer({ min: 15, max: 300 }),
  });

  it("un abierto implica un intervalo con hueco suficiente; un rechazo de la librería nunca es cerrado", () => {
    fc.assert(
      fc.property(entradas, ({ largo, desdeMin, ...resto }) => {
        const e: EntradaApertura = { ...resto, desdeMin, hastaMin: desdeMin + largo, lugar: { ...ROMA, country_code: "it" } };
        const r = evaluarApertura(e);
        if (r.estado === "abierto") {
          const necesario = Math.min(e.duracionMin, largo);
          expect(r.intervalos.some((i) => i.hastaMin - i.desdeMin >= necesario && i.desdeMin >= desdeMin && i.hastaMin <= desdeMin + largo)).toBe(true);
        }
        if (!e.opening_hours?.trim()) expect(r.estado).toBe("desconocido");
        if (e.opening_hours === "abc") expect(r.estado).toBe("desconocido");
      }),
      { numRuns: 200 },
    );
  });
});
