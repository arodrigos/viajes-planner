import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LIMITES } from "../validar";
import { aBorradorReserva, sugerirTipo } from "./aBorrador";
import type { EventoIcs, Momento } from "./tipos";

const tz = (fecha: string, hora: string, zona: string): Momento => ({ fecha, hora, zona, forma: "tzid", zonaDeducida: false });
const dia = (fecha: string): Momento => ({ fecha, hora: null, zona: null, forma: "fecha", zonaDeducida: false });
const evento = (p: Partial<EventoIcs>): EventoIcs => ({ indice: 0, titulo: "", lugar: null, geo: null, inicio: dia("2027-07-03"), fin: null, repeticionIgnorada: false, ...p });
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

describe("aBorradorReserva (lec-ac3)", () => {
  it("vuelo: origen y destino del par IATA, hora y zona de cada extremo, sin inventar sentido", () => {
    const b = aBorradorReserva(
      evento({ titulo: "Vuelo VY6104 MAD-FCO · Confirmación", inicio: tz("2027-07-03", "07:35", "Europe/Madrid"), fin: tz("2027-07-03", "10:05", "Europe/Rome") }),
      { zonaDestino: "Europe/Rome" },
    );
    expect(b.tipoSugerido).toBe("vuelo");
    expect(b.reserva).toMatchObject({ tipo: "vuelo", origen: "MAD", destino: "FCO", fecha_inicio: "2027-07-03", hora_inicio: "07:35", zona_inicio: "Europe/Madrid", fecha_fin: "2027-07-03", hora_fin: "10:05", zona_fin: "Europe/Rome" });
    expect(b.huecos).toContain("sentido");
    expect(b.huecos).not.toContain("origen");
    expect(b.deducidos).toEqual(expect.arrayContaining(["tipo", "origen", "destino"]));
    expect(b.reserva).not.toHaveProperty("localizador");
    expect(b.reserva).not.toHaveProperty("notas");
    expect(b.reserva).not.toHaveProperty("sentido");
  });

  it("tren con «X → Y» y horas UTC sin zona: usa la zona del destino y la marca como deducida", () => {
    const utc = (hora: string): Momento => ({ fecha: "2027-07-03", hora, zona: null, forma: "utc", zonaDeducida: false });
    const b = aBorradorReserva(evento({ titulo: "Tren AVE Madrid → Barcelona", inicio: utc("05:35"), fin: utc("08:10") }), { zonaDestino: "Europe/Madrid" });
    expect(b.tipoSugerido).toBe("tren");
    expect(b.reserva).toMatchObject({ origen: "Madrid", destino: "Barcelona", hora_inicio: "07:35", zona_inicio: "Europe/Madrid", hora_fin: "10:10", zona_fin: "Europe/Madrid" });
    expect(b.deducidos).toEqual(expect.arrayContaining(["zona_inicio", "zona_fin"]));
  });

  it("UTC sin zona ni destino conocido: no inventa la hora y la deja en huecos", () => {
    const utc: Momento = { fecha: "2027-07-03", hora: "05:35", zona: null, forma: "utc", zonaDeducida: false };
    const b = aBorradorReserva(evento({ titulo: "Tren AVE Madrid → Barcelona", inicio: utc, fin: utc }), { zonaDestino: null });
    expect(b.reserva.hora_inicio).toBeUndefined();
    expect(b.huecos).toEqual(expect.arrayContaining(["fecha_inicio", "hora_inicio"]));
  });

  it("hotel: SUMMARY es el nombre, LOCATION la dirección y GEO la ubicación", () => {
    const b = aBorradorReserva(evento({ titulo: "Hotel Arco Sereno", lugar: "Via dei Fiori 12, Roma", geo: { lat: 41.9, lon: 12.49 }, inicio: dia("2027-07-03"), fin: dia("2027-07-09") }), { zonaDestino: null });
    expect(b.tipoSugerido).toBe("hotel");
    expect(b.reserva).toEqual({ tipo: "hotel", nombre: "Hotel Arco Sereno", direccion: "Via dei Fiori 12, Roma", ubicacion: { lat: 41.9, lon: 12.49 }, fecha_inicio: "2027-07-03", fecha_fin: "2027-07-09" });
    expect(b.huecos).toEqual([]);
  });

  it("limpia caracteres de control y recorta; el '<img' queda literal (se escapa al pintar)", () => {
    const b = aBorradorReserva(evento({ titulo: "<img src=x onerror=alert(1)>\r\nX-INYECTADO:1".padEnd(300, "a"), lugar: "L\n".repeat(200), fin: dia("2027-07-05") }), { zonaDestino: null });
    expect(b.reserva.nombre).not.toMatch(CONTROL);
    expect(Array.from(b.reserva.nombre ?? "").length).toBeLessThanOrEqual(80);
    expect(b.reserva.nombre?.startsWith("<img src=x")).toBe(true);
    expect(Array.from(b.reserva.direccion ?? "").length).toBeLessThanOrEqual(160);
  });
});

describe("sugerirTipo (lec-ac4)", () => {
  const dias = { inicio: dia("2027-07-03"), fin: dia("2027-07-06") };
  const hora = { inicio: tz("2027-07-03", "10:00", "Europe/Madrid"), fin: null };
  it.each([
    ["Vuelo VY6104 MAD-FCO", hora, "vuelo"],
    ["Flight to Rome", hora, "vuelo"],
    ["IB3166 MAD-LHR", hora, "vuelo"],
    ["Tren Madrid → Sevilla", hora, "tren"],
    ["Renfe AVE 03120", hora, "tren"],
    ["Iryo Barcelona", hora, "tren"],
    ["Hotel Sol", dias, "hotel"],
    ["Apartamento Centro", hora, "hotel"],
    ["Check-in Casa Mar", hora, "hotel"],
    ["Reserva Casa Rural", dias, "hotel"],
    ["Entradas Coliseo", hora, "entrada"],
    ["Cena", { inicio: dia("2027-07-03"), fin: dia("2027-07-04") }, "entrada"],
  ] as const)("%s → %s", (titulo, fechas, esperado) => {
    expect(sugerirTipo(evento({ titulo, ...fechas }))).toBe(esperado);
  });
});

describe("invariantes del borrador (propiedades)", () => {
  const momento = fc.oneof(
    fc.record({ fecha: fc.constantFrom("2027-07-03", "2027-07-09"), hora: fc.constantFrom("07:35", "23:59", null), zona: fc.constantFrom("Europe/Madrid", null), forma: fc.constantFrom("tzid", "utc", "flotante", "fecha"), zonaDeducida: fc.boolean() }),
  ) as fc.Arbitrary<Momento>;
  const eventoArb = fc.record({ indice: fc.constant(0), titulo: fc.string({ maxLength: 400 }), lugar: fc.option(fc.string({ maxLength: 400 }), { nil: null }), geo: fc.constant(null), inicio: momento, fin: fc.option(momento, { nil: null }), repeticionIgnorada: fc.boolean() }) as fc.Arbitrary<EventoIcs>;

  const requeridos = (tipo: string) => (tipo === "vuelo" || tipo === "tren" ? ["sentido", "origen", "destino", "fecha_inicio", "fecha_fin", "hora_inicio", "hora_fin"] : tipo === "hotel" ? ["nombre", "fecha_inicio", "fecha_fin"] : ["nombre", "fecha_inicio", "hora_inicio"]);

  it("texto limpio y acotado; nunca sentido, localizador ni notas; todo lo exigido y ausente está en huecos", () => {
    fc.assert(
      fc.property(eventoArb, fc.constantFrom("Europe/Rome", null), (ev, zonaDestino) => {
        const b = aBorradorReserva(ev, { zonaDestino });
        const r = b.reserva as Record<string, unknown>;
        for (const campo of ["origen", "destino", "nombre", "direccion"] as const) {
          const v = r[campo];
          if (v === undefined) continue;
          expect(typeof v).toBe("string");
          expect(v as string).not.toMatch(CONTROL);
          expect(Array.from(v as string).length).toBeLessThanOrEqual(LIMITES[campo]);
        }
        expect(r.sentido).toBeUndefined();
        expect(r.localizador).toBeUndefined();
        expect(r.notas).toBeUndefined();
        for (const c of requeridos(b.tipoSugerido)) {
          if (r[c] === undefined || r[c] === "") expect(b.huecos).toContain(c);
        }
      }),
      { numRuns: 300 },
    );
  });
});
