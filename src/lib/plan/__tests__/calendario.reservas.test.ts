import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Reserva } from "@/lib/reservas/tipos";
import { franjasComoArray } from "../config-franjas";
import { generarIcsPlan } from "../calendario";
import type { Plan } from "../tipos";

const DESTINO = "Toledo";

function plan(): Plan {
  const franjas = franjasComoArray(DESTINO);
  return {
    id: "plan-ics-res",
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas,
        paradas: [
          { id: "a", franja_id: franjas[0].id, nombre: "Catedral", descripcion: "x", duracion_min: 90, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" } },
          { id: "b", franja_id: franjas[1].id, nombre: "Mirador", descripcion: "x", duracion_min: 60, prioridad: 60, procedencia: { fuente: "propuesto-sin-verificar" } },
        ],
      },
    ],
  } as Plan;
}

const VUELO: Reserva = { id: "v1", tipo: "vuelo", sentido: "ida", fecha_inicio: "2026-11-07", hora_inicio: "08:00", zona_inicio: "Europe/Madrid", fecha_fin: "2026-11-07", hora_fin: "13:00", zona_fin: "Europe/Rome", origen: "MAD", destino: "FCO", localizador: "ABC123" };
const HOTEL: Reserva = { id: "h1", tipo: "hotel", fecha_inicio: "2026-11-07", fecha_fin: "2026-11-09", nombre: "Hotel Sole" };
const ENTRADA: Reserva = { id: "e1", tipo: "entrada", fecha_inicio: "2026-11-07", hora_inicio: "10:30", zona_inicio: "Europe/Rome", nombre: "Galería Borghese" };
const OPC = { perfil: null };
const desplegar = (ics: string) => ics.replace(/\r\n[ \t]/g, "");

describe("ics con reservas (res-dia-ac4)", () => {
  it("un evento por reserva, con la zona de cada extremo, y el localizador solo para el dueño", () => {
    const ics = desplegar(generarIcsPlan(plan(), OPC, [VUELO, HOTEL, ENTRADA], true).contenido);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(5);
    expect(ics).toContain("DTSTART;TZID=Europe/Madrid:20261107T080000");
    expect(ics).toContain("DTEND;TZID=Europe/Rome:20261107T130000");
    expect(ics).toContain("DTSTART;TZID=Europe/Rome:20261107T103000");
    expect(ics).toContain("ABC123");
    expect(ics).toContain("Hotel Sole");
  });

  it("para quien no es el dueño solo van el tipo y la hora", () => {
    const ics = desplegar(generarIcsPlan(plan(), OPC, [VUELO, HOTEL, ENTRADA], false).contenido);
    for (const secreto of ["ABC123", "Sole", "Borghese", "MAD", "FCO"]) expect(ics).not.toContain(secreto);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(5);
  });

  it("un texto con saltos de línea no crea propiedades nuevas", () => {
    const ics = generarIcsPlan(plan(), OPC, [{ ...ENTRADA, nombre: "x\r\nATTENDEE:mailto:a@b.c" }], true).contenido;
    expect(ics).not.toMatch(/^ATTENDEE:/m);
  });

  it("una reserva sin zona queda flotante y no desplaza las zonas de lo que va detrás", () => {
    const ics = desplegar(generarIcsPlan(plan(), OPC, [{ ...VUELO, zona_inicio: undefined, zona_fin: undefined }, ENTRADA], true).contenido);
    expect(ics).toMatch(/^DTSTART:20261107T080000/m);
    expect(ics).toContain("DTSTART;TZID=Europe/Rome:20261107T103000");
  });

  it("invariante: tantos DTSTART como eventos, cualquiera que sea la mezcla de reservas", () => {
    const reserva = fc.constantFrom(VUELO, HOTEL, ENTRADA);
    fc.assert(
      fc.property(fc.uniqueArray(reserva, { maxLength: 3 }), fc.boolean(), (rs, dueno) => {
        const ics = generarIcsPlan(plan(), OPC, rs, dueno).contenido;
        const eventos = (ics.match(/^BEGIN:VEVENT/gm) ?? []).length;
        expect(eventos).toBe(2 + rs.length);
        expect((ics.match(/^DTSTART/gm) ?? []).length).toBe(eventos);
        expect((ics.match(/^DTEND/gm) ?? []).length).toBe(eventos);
      }),
    );
  });
});
