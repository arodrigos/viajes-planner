import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { horaDeMinutos } from "../horario";
import { horaDeSalida, minutosAhoraEnZona } from "../horaDeSalida";

const hora = fc.integer({ min: 0, max: 23 * 60 + 59 }).map(horaDeMinutos);

describe("horaDeSalida", () => {
  it("11:40 con 20 min a las 10:30 → sal antes de las 11:20 (sin segundo margen)", () => {
    expect(horaDeSalida("11:40", 20, 10 * 60 + 30)).toEqual({ estado: "a-tiempo", salida: "11:20", inicio: "11:40" });
  });

  it("a las 11:30 llegarías a las 11:50, 10 min tarde", () => {
    expect(horaDeSalida("11:40", 20, 11 * 60 + 30)).toEqual({ estado: "tarde", llegada: "11:50", retrasoMin: 10 });
  });

  it("cp-tie-03: 10:50 con 20 min sale a las 10:30; a las 10:35 llegas a las 10:55, 5 min tarde", () => {
    expect(horaDeSalida("10:50", 20, 10 * 60)).toEqual({ estado: "a-tiempo", salida: "10:30", inicio: "10:50" });
    expect(horaDeSalida("10:50", 20, 10 * 60 + 35)).toEqual({ estado: "tarde", llegada: "10:55", retrasoMin: 5 });
  });

  it("a las 11:21 (un minuto tarde) llegas a las 11:41, 1 min tarde", () => {
    expect(horaDeSalida("11:40", 20, 11 * 60 + 21)).toEqual({ estado: "tarde", llegada: "11:41", retrasoMin: 1 });
  });

  it("sin hora de inicio o sin tramo no hay línea", () => {
    expect(horaDeSalida(undefined, 20, 600)).toBeNull();
    expect(horaDeSalida("11:40", undefined, 600)).toBeNull();
  });

  it("invariante: salida = inicio − minutos (sin margen) y nunca después del inicio", () => {
    fc.assert(
      fc.property(fc.integer({ min: 80, max: 23 * 60 + 59 }), fc.integer({ min: 0, max: 50 }), (inicio, minutos) => {
        const r = horaDeSalida(horaDeMinutos(inicio), minutos, 0);
        expect(r?.estado).toBe("a-tiempo");
        if (r?.estado === "a-tiempo") expect(r.salida).toBe(horaDeMinutos(inicio - minutos));
      }),
    );
  });

  it("invariante: a tiempo si ahora ≤ salida, y el retraso nunca es negativo", () => {
    fc.assert(
      fc.property(hora, fc.integer({ min: 0, max: 90 }), fc.integer({ min: 0, max: 1439 }), (inicio, minutos, ahora) => {
        const r = horaDeSalida(inicio, minutos, ahora);
        expect(r).not.toBeNull();
        if (!r) return;
        const [h, m] = inicio.split(":").map(Number);
        const salida = h * 60 + m - minutos;
        expect(r.estado).toBe(ahora <= salida ? "a-tiempo" : "tarde");
        if (r.estado === "tarde") expect(r.retrasoMin).toBe(Math.max(0, ahora + minutos - (h * 60 + m)));
      }),
    );
  });

  it("invariante: sin inicio o sin tramo devuelve null para cualquier hora", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (ahora) => {
        expect(horaDeSalida(undefined, 10, ahora)).toBeNull();
        expect(horaDeSalida("10:00", undefined, ahora)).toBeNull();
      }),
    );
  });
});

describe("minutosAhoraEnZona", () => {
  it("usa la zona del destino, no la del dispositivo", () => {
    const instante = new Date("2027-06-09T09:30:00Z");
    expect(minutosAhoraEnZona("Europe/Lisbon", instante)).toBe(10 * 60 + 30);
    expect(minutosAhoraEnZona("America/New_York", instante)).toBe(5 * 60 + 30);
  });

  it("invariante: el resultado solo depende del instante y la zona pasados", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2020-01-01"), max: new Date("2035-01-01"), noInvalidDate: true }), (d) => {
        const a = minutosAhoraEnZona("Europe/Lisbon", d);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1440);
        expect(minutosAhoraEnZona("Europe/Lisbon", new Date(d.getTime()))).toBe(a);
      }),
    );
  });

  it("zona desconocida no lanza", () => {
    expect(() => minutosAhoraEnZona("No/Existe", new Date())).not.toThrow();
  });
});
