import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularHorarioDia, minutosDeHora, minutosDePaseo, textoRango } from "../horario";
import type { Franja, Parada } from "../tipos";

const MANANA: Franja = { id: "manana", etiqueta: "Mañana", hora_inicio: "09:30", hora_fin: "13:30" };

function parada(id: string, duracion_min: number, coordenadas?: { lat: number; lon: number }, franja_id = "manana"): Parada {
  return { id, franja_id, nombre: id, descripcion: "", duracion_min, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas };
}

// cp-hor-01: tres paradas de Belém a ~1,1 km y ~0,9 km entre sí.
const JERONIMOS = { lat: 38.6979, lon: -9.2063 };
const TORRE = { lat: 38.6916, lon: -9.2160 };
const PADRAO = { lat: 38.6937, lon: -9.2057 };

describe("calcularHorarioDia (hor-ac1)", () => {
  it("encadena inicio + duración + paseo dentro de la franja", () => {
    const dia = { franjas: [MANANA], paradas: [parada("jeronimos", 90, JERONIMOS), parada("torre", 45, TORRE), parada("padrao", 30, PADRAO)] };
    const h = calcularHorarioDia(dia);
    expect(textoRango(h.jeronimos)).toBe("09:30 – 11:00");
    expect(h.jeronimos.recortada).toBe(false);
    // El paseo es distancia / 4,5 km/h + 5 min, en minutos enteros.
    const paseo1 = minutosDePaseo(JERONIMOS, TORRE);
    expect(h.torre.inicio).toBe(`${String(Math.floor((660 + paseo1) / 60)).padStart(2, "0")}:${String((660 + paseo1) % 60).padStart(2, "0")}`);
    expect(minutosDeHora(h.padrao.inicio)).toBe(minutosDeHora(h.torre.fin) + minutosDePaseo(TORRE, PADRAO));
  });

  it("1,1 km a 4,5 km/h son 15 min más 5 de margen; 0,9 km son 12 más 5", () => {
    const a = { lat: 40, lon: 0 };
    const kmEnLat = (km: number) => ({ lat: 40 + km / 111.195, lon: 0 });
    expect(minutosDePaseo(a, kmEnLat(1.1))).toBe(20);
    expect(minutosDePaseo(a, kmEnLat(0.9))).toBe(17);
  });

  it("sin coordenadas en alguno de los dos extremos el paseo son 15 min", () => {
    expect(minutosDePaseo(undefined, { lat: 1, lon: 1 })).toBe(15);
    const h = calcularHorarioDia({ franjas: [MANANA], paradas: [parada("a", 60), parada("b", 30)] });
    expect(h.a).toEqual({ inicio: "09:30", fin: "10:30", recortada: false });
    expect(h.b.inicio).toBe("10:45");
  });

  it("si la última no cabe, se marca recortada y no se sale de la franja", () => {
    const h = calcularHorarioDia({ franjas: [MANANA], paradas: [parada("a", 120), parada("b", 120), parada("c", 30)] });
    expect(h.a.recortada).toBe(false);
    expect(h.b).toEqual({ inicio: "11:45", fin: "13:30", recortada: true });
    // Tras una recortada, las siguientes tampoco caben aunque duren poco.
    expect(h.c).toEqual({ inicio: "13:30", fin: "13:30", recortada: true });
  });

  it("cada franja arranca en su hora de inicio", () => {
    const tarde: Franja = { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" };
    const h = calcularHorarioDia({ franjas: [MANANA, tarde], paradas: [parada("a", 60), parada("b", 60, undefined, "tarde")] });
    expect(h.b.inicio).toBe("15:30");
  });
});

// Generador de franjas y paradas con coordenadas opcionales.
const arbCoord = fc.option(fc.record({ lat: fc.double({ min: 30, max: 50, noNaN: true }), lon: fc.double({ min: -10, max: 10, noNaN: true }) }), { nil: undefined });
const arbDia = fc.record({
  inicio: fc.integer({ min: 6 * 60, max: 20 * 60 }),
  largo: fc.integer({ min: 30, max: 6 * 60 }),
  paradas: fc.array(fc.record({ duracion: fc.integer({ min: 10, max: 240 }), coord: arbCoord }), { minLength: 1, maxLength: 8 }),
});

function construir(d: { inicio: number; largo: number; paradas: { duracion: number; coord?: { lat: number; lon: number } }[] }) {
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const franja: Franja = { id: "f", etiqueta: "Franja", hora_inicio: hh(d.inicio), hora_fin: hh(Math.min(d.inicio + d.largo, 23 * 60 + 59)) };
  const paradas = d.paradas.map((p, i) => parada(`p${i}`, p.duracion, p.coord, "f"));
  return { franja, paradas };
}

describe("calcularHorarioDia: invariantes (hor-ac1)", () => {
  it("invariantes 1-3: crecientes, sin solape, duración exacta, dentro de la franja y la primera en el inicio", () => {
    fc.assert(
      fc.property(arbDia, (d) => {
        const { franja, paradas } = construir(d);
        const h = calcularHorarioDia({ franjas: [franja], paradas });
        // La primera siempre arranca en la hora de inicio de la franja.
        if (paradas[0].duracion_min <= minutosDeHora(franja.hora_fin) - minutosDeHora(franja.hora_inicio)) {
          expect(h.p0.inicio).toBe(franja.hora_inicio);
        }
        paradas.forEach((p, i) => {
          const r = h[p.id];
          expect(minutosDeHora(r.inicio)).toBeGreaterThanOrEqual(minutosDeHora(franja.hora_inicio));
          expect(minutosDeHora(r.fin)).toBeLessThanOrEqual(minutosDeHora(franja.hora_fin));
          if (!r.recortada) {
            expect(minutosDeHora(r.fin) - minutosDeHora(r.inicio)).toBe(p.duracion_min);
            const siguiente = h[paradas[i + 1]?.id];
            if (siguiente && !siguiente.recortada) {
              expect(minutosDeHora(r.fin) + minutosDePaseo(p.coordenadas, paradas[i + 1].coordenadas)).toBe(minutosDeHora(siguiente.inicio));
            }
          }
        });
      }),
    );
  });

  it("una vez recortada una parada, todas las siguientes de la franja lo están", () => {
    fc.assert(
      fc.property(arbDia, (d) => {
        const { franja, paradas } = construir(d);
        const h = calcularHorarioDia({ franjas: [franja], paradas });
        const flags = paradas.map((p) => h[p.id].recortada);
        const primera = flags.indexOf(true);
        if (primera !== -1) expect(flags.slice(primera).every(Boolean)).toBe(true);
      }),
    );
  });
});
