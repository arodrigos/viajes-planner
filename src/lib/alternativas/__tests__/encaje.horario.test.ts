import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { calcularApertura } from "../encaje";

// hor-ac2: el resultado no puede depender de la zona del proceso. Node
// admite cambiar process.env.TZ en caliente, así que se recorre aquí en vez
// de depender de cómo lance vitest el CI.
const ZONAS_PROCESO = ["UTC", "America/New_York", "Pacific/Auckland"];
const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

function enCadaZona<T>(calcular: () => T): T[] {
  return ZONAS_PROCESO.map((tz) => {
    process.env.TZ = tz;
    return calcular();
  });
}

describe("calcularApertura sobre el intervalo (hor-ac2, cp-hor-02)", () => {
  const MADRID = "Europe/Madrid";
  const HORARIO = "Mo-Su 10:00-14:00";

  it("cierra a mitad de la visita: cerrada con la hora de cierre, igual con cualquier TZ del proceso", () => {
    const resultados = enCadaZona(() => calcularApertura(HORARIO, { fecha: "2026-11-07", inicio: "13:00", fin: "14:30" }, MADRID));
    for (const r of resultados) expect(r).toEqual({ estado: "cerrada", cierre: "14:00", zona: MADRID });
  });

  it("la visita dentro del horario es abierta con cualquier TZ del proceso", () => {
    const resultados = enCadaZona(() => calcularApertura(HORARIO, { fecha: "2026-11-07", inicio: "10:30", fin: "12:00" }, MADRID));
    for (const r of resultados) expect(r.estado).toBe("abierta");
  });

  it("empezar antes de que abra es cerrada sin hora de cierre", () => {
    expect(calcularApertura(HORARIO, { fecha: "2026-11-07", inicio: "08:00", fin: "09:30" }, MADRID)).toEqual({ estado: "cerrada", zona: MADRID });
  });

  it("sin horario o sin zona: desconocida, nunca un horario inventado", () => {
    expect(calcularApertura(undefined, { fecha: "2026-11-07", inicio: "10:00", fin: "11:00" }, MADRID).estado).toBe("desconocida");
    expect(calcularApertura(HORARIO, { fecha: "2026-11-07", inicio: "10:00", fin: "11:00" }, null).estado).toBe("desconocida");
  });

  it("el día del cambio de hora de Madrid (2026-10-25) la evaluación sigue la hora de pared", () => {
    const r = calcularApertura(HORARIO, { fecha: "2026-10-25", inicio: "09:00", fin: "10:30" }, MADRID);
    expect(r).toEqual({ estado: "cerrada", zona: MADRID });
    expect(calcularApertura(HORARIO, { fecha: "2026-10-25", inicio: "10:00", fin: "10:30" }, MADRID).estado).toBe("abierta");
  });

  it("invariante 4: abierta solo si el horario cubre todo el intervalo; el cierre a mitad se informa", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 12 }), // apertura
        fc.integer({ min: 13, max: 20 }), // cierre
        fc.integer({ min: 7 * 60, max: 21 * 60 }), // inicio visita (min)
        fc.integer({ min: 15, max: 180 }), // duración
        fc.constantFrom(...ZONAS_PROCESO),
        (abre, cierra, inicio, duracion, tz) => {
          process.env.TZ = tz;
          const fin = Math.min(inicio + duracion, 23 * 60 + 59);
          const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const r = calcularApertura(`Mo-Su ${String(abre).padStart(2, "0")}:00-${cierra}:00`, { fecha: "2026-11-07", inicio: hh(inicio), fin: hh(fin) }, "Europe/Madrid");
          const cubierto = inicio >= abre * 60 && fin <= cierra * 60;
          expect(r.estado === "abierta").toBe(cubierto);
          if (r.estado === "cerrada" && inicio >= abre * 60 && inicio < cierra * 60) expect(r.cierre).toBe(`${cierra}:00`);
        },
      ),
    );
  });
});
