import { describe, expect, it } from "vitest";
import { piezasReserva } from "../resumen";

describe("piezasReserva (res-ac1)", () => {
  it("el vuelo de ida se lee «Vuelo de ida · MAD → FCO · llega 13:00 · ABC123»", () => {
    const r = { id: "1", tipo: "vuelo" as const, sentido: "ida" as const, fecha_inicio: "2027-03-05", hora_inicio: "08:00", fecha_fin: "2027-03-05", hora_fin: "13:00", origen: "MAD", destino: "FCO", localizador: "ABC123" };
    expect(piezasReserva(r).join(" · ")).toBe("Vuelo de ida · MAD → FCO · llega 13:00 · ABC123");
  });

  it("el de vuelta enseña la salida, el hotel su último día y la entrada su hora", () => {
    expect(piezasReserva({ id: "1", tipo: "tren", sentido: "vuelta", fecha_inicio: "2027-03-08", hora_inicio: "18:40", fecha_fin: "2027-03-08", hora_fin: "21:00", origen: "Roma", destino: "Florencia" }).join(" · ")).toBe("Tren de vuelta · Roma → Florencia · sale 18:40");
    expect(piezasReserva({ id: "2", tipo: "hotel", nombre: "Hotel Sole", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-08" })[0]).toBe("Hotel Hotel Sole");
    expect(piezasReserva({ id: "3", tipo: "entrada", nombre: "Borghese", fecha_inicio: "2027-03-06", hora_inicio: "10:30" }).join(" · ")).toBe("Entrada Borghese · a las 10:30");
  });
});
