import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { comprobarFichero, leerIcs } from "../leerIcs";
import { MOTIVOS_FALLO } from "../leerIcs";

const fixture = (n: string) => readFileSync(join(__dirname, "..", "__fixtures__", n), "utf8");
const vevent = (i: number) => `BEGIN:VEVENT\r\nUID:${i}@x\r\nDTSTART:20270703T100000Z\r\nSUMMARY:E${i}\r\nEND:VEVENT\r\n`;
const calendario = (n: number) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//ES\r\n${Array.from({ length: n }, (_, i) => vevent(i)).join("")}END:VCALENDAR\r\n`;

describe("leerIcs · formas de fecha (lec-ac1)", () => {
  it("TZID IANA: conserva hora de pared y zona de cada extremo", async () => {
    const r = await leerIcs(fixture("vuelo-ida-vuelta.ics"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eventos).toHaveLength(2);
    expect(r.eventos[0].inicio).toEqual({ fecha: "2027-07-03", hora: "07:35", zona: "Europe/Madrid", forma: "tzid", zonaDeducida: false });
    expect(r.eventos[0].fin).toMatchObject({ hora: "10:05", zona: "Europe/Rome" });
    expect(r.eventos[1].inicio).toMatchObject({ fecha: "2027-07-09", hora: "19:20", zona: "Europe/Rome" });
  });

  it("UTC con GEO: pasa la hora a la zona del punto", async () => {
    const r = await leerIcs(fixture("tren-utc-geo.ics"));
    if (!r.ok) throw new Error("no ok");
    expect(r.eventos[0].inicio).toEqual({ fecha: "2027-07-03", hora: "07:35", zona: "Europe/Madrid", forma: "utc", zonaDeducida: false });
    expect(r.eventos[0].geo).toEqual({ lat: 40.4065, lon: -3.6895 });
  });

  it("UTC sin GEO: deja la hora en UTC y la zona vacía", async () => {
    const r = await leerIcs(calendario(1));
    if (!r.ok) throw new Error("no ok");
    expect(r.eventos[0].inicio).toMatchObject({ hora: "10:00", zona: null, forma: "utc" });
  });

  it("flotante y fecha sin hora", async () => {
    const f = await leerIcs(fixture("flotante.ics"));
    if (!f.ok) throw new Error("no ok");
    expect(f.eventos[0].inicio).toMatchObject({ hora: "10:00", zona: null, forma: "flotante" });
    const h = await leerIcs(fixture("hotel-booking.ics"));
    if (!h.ok) throw new Error("no ok");
    expect(h.eventos[0].inicio).toMatchObject({ fecha: "2027-07-03", hora: null, forma: "fecha" });
    expect(h.eventos[0].fin).toMatchObject({ fecha: "2027-07-09", hora: null, forma: "fecha" });
    expect(h.eventos[0].lugar).toBe("Via dei Fiori 12, Roma");
  });
});

describe("leerIcs · TZID no IANA (lec-ac5)", () => {
  it("deja la hora de pared y ninguna zona inventada", async () => {
    const r = await leerIcs(fixture("tzid-windows.ics"));
    if (!r.ok) throw new Error("no ok");
    expect(r.eventos[0].inicio).toMatchObject({ hora: "09:00", zona: null });
  });
});

describe("límites (lec-ac2)", () => {
  it("comprobarFichero rechaza más de 256 KB antes de leer", () => {
    expect(comprobarFichero({ size: 262145, name: "x.ics", type: "text/calendar" })).toBe("demasiado-grande");
    expect(comprobarFichero({ size: 262144, name: "x.ics", type: "text/calendar" })).toBeNull();
  });

  it("motivos de texto: no-es-ics, sin-eventos, demasiados-eventos", async () => {
    expect(await leerIcs(fixture("no-es-ics.txt"))).toEqual({ ok: false, motivo: "no-es-ics" });
    expect(await leerIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n")).toEqual({ ok: false, motivo: "sin-eventos" });
    expect(await leerIcs(calendario(21))).toEqual({ ok: false, motivo: "demasiados-eventos" });
    const veinte = await leerIcs(calendario(20));
    expect(veinte.ok && veinte.eventos.length).toBe(20);
  });

  it("RRULE malformada: se ignora, devuelve la primera fecha y es rápido", async () => {
    const t = performance.now();
    const r = await leerIcs(fixture("rrule-malformada.ics"));
    expect(performance.now() - t).toBeLessThan(500);
    if (!r.ok) throw new Error("no ok");
    expect(r.eventos).toHaveLength(1);
    expect(r.eventos[0].repeticionIgnorada).toBe(true);
    expect(r.eventos[0].inicio).toMatchObject({ fecha: "2027-07-03", hora: "09:00" });
  });

  it("un VEVENT sin DTSTART válido da malformado, no una excepción", async () => {
    const r = await leerIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
    expect(r).toEqual({ ok: false, motivo: "malformado" });
  });
});

describe("invariantes (propiedades)", () => {
  it("nunca lanza y siempre devuelve ok o un motivo conocido", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.string().map((s) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${s}\r\nEND:VEVENT\r\nEND:VCALENDAR`)), async (texto) => {
        const r = await leerIcs(texto);
        if (r.ok) return r.eventos.length >= 1 && r.eventos.length <= 20;
        return (MOTIVOS_FALLO as readonly string[]).includes(r.motivo);
      }),
      { numRuns: 150 },
    );
  });

  it("con zona y hora, el instante local coincide con el DTSTART en UTC", async () => {
    await fc.assert(
      fc.asyncProperty(fc.date({ min: new Date("2027-01-01T00:00:00Z"), max: new Date("2028-12-31T00:00:00Z"), noInvalidDate: true }), fc.constantFrom([40.4, -3.7, "Europe/Madrid"], [41.9, 12.5, "Europe/Rome"], [40.7, -74.0, "America/New_York"]), async (d, [lat, lon, zona]) => {
        const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const r = await leerIcs(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:${iso}\r\nGEO:${lat};${lon}\r\nEND:VEVENT\r\nEND:VCALENDAR`);
        if (!r.ok) throw new Error("no ok");
        const m = r.eventos[0].inicio;
        expect(m.zona).toBe(zona);
        const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona as string, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
        const g = (t: string) => partes.find((p) => p.type === t)!.value;
        expect(m.fecha).toBe(`${g("year")}-${g("month")}-${g("day")}`);
        expect(m.hora).toBe(`${g("hour")}:${g("minute")}`);
      }),
      { numRuns: 60 },
    );
  });
});
