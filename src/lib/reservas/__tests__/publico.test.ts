import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aReservaPublica } from "../publico";
import type { Reserva } from "../tipos";

const CLAVES_PUBLICAS = ["id", "tipo", "sentido", "fecha", "hora"];

const vueloIda: Reserva = { id: "1", tipo: "vuelo", sentido: "ida", fecha_inicio: "2027-03-05", hora_inicio: "08:00", fecha_fin: "2027-03-05", hora_fin: "13:00", origen: "MAD", destino: "FCO", localizador: "ABC123", notas: "ventanilla" };
const hotel: Reserva = { id: "2", tipo: "hotel", nombre: "Hotel Sole", direccion: "Via Roma 1", ubicacion: { lat: 41.9, lon: 12.5 }, fecha_inicio: "2027-03-05", fecha_fin: "2027-03-08" };
const entrada: Reserva = { id: "3", tipo: "entrada", nombre: "Galería Borghese", fecha_inicio: "2027-03-06", hora_inicio: "10:30", localizador: "QQ1" };

describe("aReservaPublica (res-ac5)", () => {
  it("de un vuelo de ida da la llegada; de una entrada, su hora; del hotel, solo el día", () => {
    expect(aReservaPublica(vueloIda)).toEqual({ id: "1", tipo: "vuelo", sentido: "ida", fecha: "2027-03-05", hora: "13:00" });
    expect(aReservaPublica(entrada)).toEqual({ id: "3", tipo: "entrada", fecha: "2027-03-06", hora: "10:30" });
    expect(aReservaPublica(hotel)).toEqual({ id: "2", tipo: "hotel", fecha: "2027-03-05" });
  });

  it("de un vuelo de vuelta da la salida", () => {
    expect(aReservaPublica({ ...vueloIda, sentido: "vuelta", hora_inicio: "18:40", fecha_inicio: "2027-03-08", fecha_fin: "2027-03-08" })).toMatchObject({ fecha: "2027-03-08", hora: "18:40" });
  });

  it("el JSON de la proyección no contiene ningún dato privado", () => {
    const json = JSON.stringify([vueloIda, hotel, entrada].map(aReservaPublica));
    for (const privado of ["ABC123", "Hotel Sole", "Galería Borghese", "FCO", "MAD", "Via Roma", "ventanilla", "41.9", "QQ1"]) expect(json).not.toContain(privado);
  });

  // Invariante: sea cual sea la entrada, solo salen id, tipo, sentido, fecha y hora.
  it("property: las claves de la salida son un subconjunto de las públicas", () => {
    const texto = fc.option(fc.string(), { nil: undefined });
    const reserva = fc.record(
      {
        id: fc.uuid(),
        tipo: fc.constantFrom("vuelo", "tren", "hotel", "entrada"),
        sentido: fc.constantFrom("ida", "vuelta", undefined),
        fecha_inicio: fc.constant("2027-03-05"),
        hora_inicio: texto,
        fecha_fin: texto,
        hora_fin: texto,
        zona_inicio: texto,
        zona_fin: texto,
        origen: texto,
        destino: texto,
        nombre: texto,
        direccion: texto,
        localizador: texto,
        notas: texto,
        ubicacion: fc.option(fc.record({ lat: fc.double({ min: -90, max: 90, noNaN: true }), lon: fc.double({ min: -180, max: 180, noNaN: true }) }), { nil: undefined }),
      },
      { requiredKeys: ["id", "tipo", "fecha_inicio"] },
    );
    fc.assert(
      fc.property(reserva, (r) => {
        const salida = aReservaPublica(r as Reserva);
        for (const clave of Object.keys(salida)) expect(CLAVES_PUBLICAS).toContain(clave);
      }),
      { numRuns: 300 },
    );
  });
});
