import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ERRORES_RESERVA as E } from "@/lib/textos/reservas";
import { LIMITES, limpiarTexto, validarReserva } from "../validar";

const vuelo = { tipo: "vuelo", sentido: "ida", origen: "MAD", destino: "FCO", fecha_inicio: "2027-03-05", hora_inicio: "08:00", fecha_fin: "2027-03-05", hora_fin: "13:00", localizador: "ABC123" };
const hotel = { tipo: "hotel", nombre: "Hotel Sole", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-08" };
const entrada = { tipo: "entrada", nombre: "Galería Borghese", fecha_inicio: "2027-03-06", hora_inicio: "10:30" };

function errores(entradaMala: unknown, contexto = {}) {
  const r = validarReserva(entradaMala, contexto);
  if (r.ok) throw new Error("debía fallar");
  return r.errores;
}

// Modelo en TS de los CHECK de la migración 037 sobre la fila ya normalizada.
function aceptaLaBase(r: Record<string, unknown>): boolean {
  const tipo = r.tipo as string;
  const transporte = tipo === "vuelo" || tipo === "tren";
  const fin = r.fecha_fin as string | undefined;
  const ini = r.fecha_inicio as string;
  const hi = r.hora_inicio as string | undefined;
  const hf = r.hora_fin as string | undefined;
  if ((r.sentido !== undefined) !== transporte) return false;
  if (fin !== undefined && fin < ini) return false;
  if (transporte && !(hi && fin && hf && r.origen && r.destino && (fin > ini || hf > hi))) return false;
  if (tipo === "hotel" && !(r.nombre && fin)) return false;
  if (tipo === "entrada" && !(r.nombre && hi && (hf === undefined || ((fin === undefined || fin === ini) && hf > hi)))) return false;
  for (const [campo, max] of Object.entries(LIMITES)) {
    const v = r[campo];
    if (typeof v === "string" && Array.from(v).length > max) return false;
  }
  return true;
}

describe("validarReserva (res-ac2, res-ac3)", () => {
  it("acepta un vuelo, un hotel y una entrada completos", () => {
    for (const e of [vuelo, hotel, entrada]) expect(validarReserva(e).ok).toBe(true);
  });

  it("explica en su campo que falta la hora de llegada", () => {
    const { hora_fin: _omitida, ...sinLlegada } = vuelo;
    expect(errores(sinLlegada).hora_fin).toBe(E.falta.hora_fin);
    expect(E.falta.hora_fin).toMatch(/tarjeta de embarque/);
  });

  it("la llegada anterior a la salida es un error, y la salida del hotel anterior a la entrada también", () => {
    expect(errores({ ...vuelo, hora_fin: "07:00" }).hora_fin).toBe(E.llegadaAntesDeSalida);
    expect(errores({ ...vuelo, fecha_fin: "2027-03-04" }).fecha_fin).toBe(E.llegadaAntesDeSalida);
    expect(errores({ ...hotel, fecha_fin: "2027-03-01" }).fecha_fin).toBe(E.salidaHotelAntesDeEntrada);
  });

  it("una llegada al día siguiente con hora menor es válida (vuelo nocturno)", () => {
    expect(validarReserva({ ...vuelo, fecha_fin: "2027-03-06", hora_fin: "06:00" }).ok).toBe(true);
  });

  it("la fecha fuera del viaje se rechaza; el transporte admite un día de margen", () => {
    const viaje = { viaje: { desde: "2027-03-05", hasta: "2027-03-08" } };
    expect(errores({ ...entrada, fecha_inicio: "2027-04-01" }, viaje).fecha_inicio).toBe(E.fueraDelViaje);
    expect(errores({ ...hotel, fecha_fin: "2027-03-09" }, viaje).fecha_fin).toBe(E.fueraDelViaje);
    expect(validarReserva({ ...vuelo, fecha_inicio: "2027-03-04", fecha_fin: "2027-03-05" }, viaje).ok).toBe(true);
  });

  it("un texto que se pasa de su longitud máxima dice cuántos caracteres admite", () => {
    expect(errores({ ...vuelo, localizador: "X".repeat(21) }).localizador).toBe(E.demasiado(20));
    expect(errores({ ...entrada, notas: "n".repeat(201) }).notas).toBe(E.demasiado(200));
    // Un emoji cuenta como un carácter, igual que en Postgres.
    expect(validarReserva({ ...entrada, nombre: "😀".repeat(80) }).ok).toBe(true);
  });

  it("res-ac7: quita caracteres de control y deja el HTML como texto", () => {
    const r = validarReserva({ ...entrada, notas: "<img src=x onerror=alert(1)>\r\nATTENDEE:mailto:x@y" });
    expect(r.ok && r.reserva.notas).toBe("<img src=x onerror=alert(1)>ATTENDEE:mailto:x@y");
    expect(limpiarTexto(" a\u0000b\n ")).toBe("ab");
  });

  it("rechaza tipo desconocido, cuerpo que no es un objeto y sentido en un hotel", () => {
    expect(errores({ tipo: "barco" }).tipo).toBe(E.tipo);
    expect(errores(null).general).toBe(E.cuerpo);
    expect(errores([]).general).toBe(E.cuerpo);
    expect(errores({ ...hotel, sentido: "ida" }).sentido).toBeDefined();
  });

  it("la ubicación solo vale en el hotel y dentro de rango", () => {
    expect(validarReserva({ ...hotel, ubicacion: { lat: 41.9, lon: 12.5 } }).ok).toBe(true);
    expect(errores({ ...hotel, ubicacion: { lat: 91, lon: 0 } }).ubicacion).toBe(E.ubicacion);
    expect(errores({ ...entrada, ubicacion: { lat: 1, lon: 1 } }).ubicacion).toBe(E.ubicacion);
  });

  it("normaliza HH:MM:SS de la base y rechaza horas imposibles", () => {
    const r = validarReserva({ ...entrada, hora_inicio: "10:30:00" });
    expect(r.ok && r.reserva.hora_inicio).toBe("10:30");
    expect(errores({ ...entrada, hora_inicio: "25:00" }).hora_inicio).toBe(E.hora);
    expect(errores({ ...entrada, fecha_inicio: "2027-02-30" }).fecha_inicio).toBe(E.fecha);
  });

  // Invariante: validarReserva acepta si y solo si el CHECK de la 037 lo haría.
  // Este sentido (aceptada ⇒ la base la acepta) es el que protege de un 500.
  it("property: toda reserva aceptada cumple los CHECK de la migración 037", () => {
    const texto = fc.option(fc.string({ maxLength: 90 }), { nil: undefined });
    const fecha = fc.date({ min: new Date("2027-01-01"), max: new Date("2027-12-31"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    const hora = fc.option(fc.tuple(fc.integer({ min: 0, max: 24 }), fc.integer({ min: 0, max: 60 })).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`), { nil: undefined });
    const arbitraria = fc.record(
      {
        tipo: fc.constantFrom("vuelo", "tren", "hotel", "entrada", "otro"),
        sentido: fc.constantFrom("ida", "vuelta", undefined),
        fecha_inicio: fecha,
        hora_inicio: hora,
        fecha_fin: fc.option(fecha, { nil: undefined }),
        hora_fin: hora,
        origen: texto,
        destino: texto,
        nombre: texto,
        direccion: texto,
        localizador: texto,
        notas: texto,
      },
      { requiredKeys: ["tipo", "fecha_inicio"] },
    );
    fc.assert(
      fc.property(arbitraria, (entradaAleatoria) => {
        const r = validarReserva(entradaAleatoria);
        if (r.ok) expect(aceptaLaBase(r.reserva as unknown as Record<string, unknown>)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("property: nunca lanza con entradas arbitrarias", () => {
    fc.assert(fc.property(fc.anything(), (x) => void validarReserva(x)), { numRuns: 300 });
  });
});
