import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { franjaDelElemento, hotelDelDia, reservasDelDia, reservasPublicasDelDia } from "../enElDia";
import { aReservasPublicas } from "../publico";
import type { Reserva } from "../tipos";

const VUELO_IDA: Reserva = { id: "v1", tipo: "vuelo", sentido: "ida", fecha_inicio: "2026-11-16", hora_inicio: "08:00", zona_inicio: "Europe/Madrid", fecha_fin: "2026-11-16", hora_fin: "13:00", zona_fin: "Europe/Rome", origen: "MAD", destino: "FCO", localizador: "ABC123" };
const VUELO_VUELTA: Reserva = { id: "v2", tipo: "vuelo", sentido: "vuelta", fecha_inicio: "2026-11-18", hora_inicio: "18:40", zona_inicio: "Europe/Rome", fecha_fin: "2026-11-18", hora_fin: "21:00", zona_fin: "Europe/Madrid", origen: "FCO", destino: "MAD" };
const HOTEL: Reserva = { id: "h1", tipo: "hotel", fecha_inicio: "2026-11-16", fecha_fin: "2026-11-18", nombre: "Hotel Sole", ubicacion: { lat: 41.9, lon: 12.47 } };
const ENTRADA: Reserva = { id: "e1", tipo: "entrada", fecha_inicio: "2026-11-17", hora_inicio: "10:30", nombre: "Galería Borghese" };

describe("reservasDelDia (res-dia-ac1)", () => {
  it("la ida llega el día de llegada, la vuelta sale el de salida, el hotel entra el primer día y la entrada tiene su hora", () => {
    expect(reservasDelDia([VUELO_IDA, HOTEL, ENTRADA, VUELO_VUELTA], "2026-11-16").map((f) => [f.clase, f.desdeMin])).toEqual([
      ["llegada", 13 * 60],
      ["hotel", 1439],
    ]);
    expect(reservasDelDia([VUELO_IDA, HOTEL, ENTRADA, VUELO_VUELTA], "2026-11-17")).toEqual([
      { reservaId: "e1", tipo: "entrada", clase: "entrada", desdeMin: 630, hastaMin: 720, detalle: "Galería Borghese" },
    ]);
    expect(reservasDelDia([VUELO_IDA, HOTEL, ENTRADA, VUELO_VUELTA], "2026-11-18")).toEqual([
      { reservaId: "v2", tipo: "vuelo", clase: "salida", desdeMin: 18 * 60 + 40, hastaMin: 18 * 60 + 40, zona: "Europe/Rome", detalle: "FCO → MAD" },
    ]);
  });

  it("una vuelo que llega al día siguiente de salir cuenta en el día de llegada", () => {
    const nocturno = { ...VUELO_IDA, fecha_inicio: "2026-11-15", fecha_fin: "2026-11-16" };
    expect(reservasDelDia([nocturno], "2026-11-15")).toEqual([]);
    expect(reservasDelDia([nocturno], "2026-11-16")).toHaveLength(1);
  });

  it("la vista del invitado trae lo mismo sin detalle ni zona", () => {
    const publicas = aReservasPublicas([VUELO_IDA, HOTEL, ENTRADA]);
    const fijos = reservasPublicasDelDia(publicas, "2026-11-16");
    expect(fijos.map((f) => f.clase)).toEqual(["llegada", "hotel"]);
    expect(JSON.stringify(fijos)).not.toMatch(/MAD|FCO|Sole|Borghese|ABC123|Europe/);
  });

  it("el hotel con ubicación en su estancia es el ancla; sin ubicación o fuera de ella, no", () => {
    expect(hotelDelDia([HOTEL], "2026-11-17")?.id).toBe("h1");
    expect(hotelDelDia([HOTEL], "2026-11-19")).toBeUndefined();
  });

  it("franjaDelElemento: la que contiene la hora, o ninguna (al final del día)", () => {
    const franjas = [
      { id: "manana", desdeMin: 540, hastaMin: 780 },
      { id: "tarde", desdeMin: 900, hastaMin: 1200 },
    ];
    expect(franjaDelElemento({ reservaId: "x", tipo: "entrada", clase: "entrada", desdeMin: 630, hastaMin: 720 }, franjas)).toBe("manana");
    expect(franjaDelElemento({ reservaId: "x", tipo: "entrada", clase: "entrada", desdeMin: 23 * 60 + 30, hastaMin: 1500 }, franjas)).toBeNull();
    expect(franjaDelElemento({ reservaId: "h", tipo: "hotel", clase: "hotel", desdeMin: 1439, hastaMin: 1439, sinHora: true }, franjas)).toBeNull();
  });
});

describe("invariante: solo las fechas que le tocan", () => {
  const hora = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const fecha = fc.integer({ min: 1, max: 28 }).map((d) => `2026-11-${String(d).padStart(2, "0")}`);
  const reserva = fc.oneof(
    fc.record({ id: fc.uuid(), tipo: fc.constantFrom("vuelo" as const, "tren" as const), sentido: fc.constantFrom("ida" as const, "vuelta" as const), fecha_inicio: fecha, hora_inicio: hora, fecha_fin: fecha, hora_fin: hora }),
    fc.record({ id: fc.uuid(), tipo: fc.constant("hotel" as const), fecha_inicio: fecha, fecha_fin: fecha }),
    fc.record({ id: fc.uuid(), tipo: fc.constant("entrada" as const), fecha_inicio: fecha, hora_inicio: hora }),
  ) as fc.Arbitrary<Reserva>;

  it("cada reserva produce elementos solo en su fecha (ida: llegada; vuelta: salida; hotel y entrada: inicio) y como mucho uno", () => {
    fc.assert(
      fc.property(reserva, fecha, (r, f) => {
        const fijos = reservasDelDia([r], f);
        const esperada = r.tipo === "vuelo" || r.tipo === "tren" ? (r.sentido === "ida" ? r.fecha_fin : r.fecha_inicio) : r.fecha_inicio;
        expect(fijos.length).toBe(f === esperada ? 1 : 0);
      }),
    );
  });
});
