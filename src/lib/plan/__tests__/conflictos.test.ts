import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectarConflictosDia, evaluarDia, type DiaConflictable, type ParadaConflictable } from "../conflictos";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];
const OPCIONES = { perfil: null };
const ctx = { opciones: OPCIONES, countryCode: "it" };

function parada(id: string, franja: string, reglaOsm: string | undefined, extra: Partial<ParadaConflictable> = {}): ParadaConflictable {
  return {
    id,
    franja_id: franja,
    duracion_min: 90,
    coordenadas: { lat: 41.9, lon: 12.5 },
    lugar: reglaOsm ? { etiquetas: { opening_hours: reglaOsm } } : undefined,
    ...extra,
  };
}
const dia = (fecha: string, paradas: ParadaConflictable[]): DiaConflictable => ({ fecha, franjas: FRANJAS, paradas });

describe("detectarConflictosDia (ape-ac1)", () => {
  it("un museo en lunes por la mañana es 'cerrado-en-franja' y el texto dice lunes", () => {
    const conflictos = detectarConflictosDia(dia("2026-11-16", [parada("m", "manana", "Mo off; Tu-Su 10:00-18:00")]), ctx);
    expect(conflictos).toHaveLength(1);
    expect(conflictos[0]).toMatchObject({ paradaId: "m", clase: "cerrado-en-franja", procedencia: { fuente: "osm" } });
    expect(conflictos[0].texto).toContain("lunes");
  });

  it("el martes por la mañana abre a las 10:00 y esperar no es conflicto", () => {
    expect(detectarConflictosDia(dia("2026-11-17", [parada("m", "manana", "Mo off; Tu-Su 10:00-18:00")]), ctx)).toEqual([]);
  });

  it("llegar a las 17:10 a un sitio que cierra a las 18:00 y dura 90 min es 'cerrado-a-esa-hora'", () => {
    const d = dia("2026-11-17", [parada("m", "tarde", "Tu-Su 10:00-18:00")]);
    const horarios = { m: { inicioMin: 17 * 60 + 10, finMin: 18 * 60 + 40 } };
    const [c] = detectarConflictosDia(d, { ...ctx, horarios });
    expect(c).toMatchObject({ clase: "cerrado-a-esa-hora", texto: "Cierra a las 18:00 y llegas a las 17:10" });
    expect(detectarConflictosDia(d, { ...ctx, horarios: { m: { inicioMin: 16 * 60 + 30, finMin: 18 * 60 } } })).toEqual([]);
  });

  it("sin país y con PH la parada queda sin confirmar y no es conflicto", () => {
    const d = dia("2026-12-08", [parada("m", "manana", "Mo-Su 10:00-18:00; PH off")]);
    expect(evaluarDia(d, { opciones: OPCIONES })).toEqual({ conflictos: [], sinConfirmar: ["m"] });
    expect(detectarConflictosDia(d, ctx)).toHaveLength(1);
  });

  it("una regla con comentario se rotula como sin confirmar y no suma", () => {
    const d = dia("2026-11-17", [parada("a", "manana", "Mo off; Tu-Su 10:00-18:00"), parada("b", "manana", 'Mo-Su 10:00-18:00 "por cita"')]);
    const r = evaluarDia(d, ctx);
    expect(r.conflictos).toEqual([]);
    expect(r.sinConfirmar).toEqual(["b"]);
  });

  it("no muta el día y es repetible", () => {
    const d = dia("2026-11-16", [parada("m", "manana", "Mo off; Tu-Su 10:00-18:00")]);
    const copia = structuredClone(d);
    expect(detectarConflictosDia(d, ctx)).toEqual(detectarConflictosDia(d, ctx));
    expect(d).toEqual(copia);
  });

  it("sin horario en OSM o sin coordenadas no hay nada que comprobar", () => {
    expect(detectarConflictosDia(dia("2026-11-16", [parada("a", "manana", undefined), parada("b", "manana", "Mo off", { coordenadas: undefined })]), ctx)).toEqual([]);
  });
});

describe("invariantes de detectarConflictosDia", () => {
  const reglas = fc.constantFrom("Mo off; Tu-Su 10:00-18:00", "24/7", "Mo-Su 09:00-13:00", 'Mo-Su 10:00-18:00 "por cita"', "abc", "Mo-Fr 15:00-19:00");
  const paradas = fc.array(fc.record({ regla: reglas, franja: fc.constantFrom("manana", "tarde"), dur: fc.integer({ min: 15, max: 180 }) }), { minLength: 1, maxLength: 6 });
  const fechas = fc.integer({ min: 0, max: 60 }).map((d) => new Date(Date.UTC(2026, 10, 1 + d)).toISOString().slice(0, 10));

  it("nunca hay conflicto de horario en una parada sin horario interpretable y es pura", () => {
    fc.assert(
      fc.property(fechas, paradas, (fecha, ps) => {
        const d = dia(fecha, ps.map((p, i) => parada(`p${i}`, p.franja, p.regla, { duracion_min: p.dur })));
        const r1 = evaluarDia(d, ctx);
        expect(evaluarDia(d, ctx)).toEqual(r1);
        for (const c of r1.conflictos) {
          const regla = d.paradas.find((p) => p.id === c.paradaId)?.lugar?.etiquetas.opening_hours;
          expect(regla).not.toBe("abc");
          expect(regla).not.toBe("24/7");
        }
        for (const id of r1.sinConfirmar) expect(r1.conflictos.some((c) => c.paradaId === id)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
