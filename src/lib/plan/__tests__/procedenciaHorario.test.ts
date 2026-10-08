import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEXTOS_HORARIO } from "@/lib/textos/horario";
import { procedenciaHorario, type EntradaProcedenciaHorario } from "../procedenciaHorario";

const HOY = "2026-10-08";
const base: EntradaProcedenciaHorario = { tieneHorario: true, hoy: HOY, casada: true, posibleCierre: false };

// dif-ac1: la tabla del diseño, literal.
describe("procedenciaHorario (dif-ac1)", () => {
  it.each([
    { nombre: "2021 → comprobado en 2021 y botón", fecha: "2021-03-02", rotulo: "Horario según OpenStreetMap · comprobado en 2021", boton: true },
    { nombre: "2026 → sin botón", fecha: "2026-05-01", rotulo: "Horario según OpenStreetMap · comprobado en 2026", boton: false },
    { nombre: "ausente → sin fecha de comprobación y botón", fecha: undefined, rotulo: "Horario según OpenStreetMap · sin fecha de comprobación", boton: true },
    { nombre: "solo año 2024 se toma desde enero: más de 2 años y botón", fecha: "2024", rotulo: "Horario según OpenStreetMap · comprobado en 2024", boton: true },
    { nombre: "justo 730 días no es antiguo", fecha: "2024-10-08", rotulo: "Horario según OpenStreetMap · comprobado en 2024", boton: false },
    { nombre: "731 días sí", fecha: "2024-10-07", rotulo: "Horario según OpenStreetMap · comprobado en 2024", boton: true },
  ])("$nombre", ({ fecha, rotulo, boton }) => {
    const r = procedenciaHorario({ ...base, fechaComprobacion: fecha });
    expect(r.rotulo).toBe(rotulo);
    expect(r.ofrecerGoogle).toBe(boton);
  });

  it("una parada no casada nunca ofrece el botón, tenga la fecha que tenga", () => {
    for (const fecha of [undefined, "2010", "2026-10-01"]) {
      expect(procedenciaHorario({ ...base, casada: false, fechaComprobacion: fecha, posibleCierre: true }).ofrecerGoogle).toBe(false);
    }
  });

  it("un horario reciente con aviso de cierre ofrece el botón y avisa de que puede estar cerrado", () => {
    const r = procedenciaHorario({ ...base, fechaComprobacion: "2026-09-01", posibleCierre: true });
    expect(r.ofrecerGoogle).toBe(true);
    expect(r.aviso).toBe(TEXTOS_HORARIO.avisoCierre.texto);
  });

  it("sin etiqueta opening_hours no hay rótulo ni aviso, pero la parada casada puede comprobarse", () => {
    expect(procedenciaHorario({ ...base, tieneHorario: false })).toEqual({ rotulo: null, aviso: null, ofrecerGoogle: true });
  });

  it("una fecha ilegible se trata como ausente", () => {
    expect(procedenciaHorario({ ...base, fechaComprobacion: "ayer" }).rotulo).toBe(TEXTOS_HORARIO.rotuloSinFecha.texto);
  });
});

const fechaIso = fc.date({ min: new Date("2000-01-01"), max: new Date("2100-12-31"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
const fechaParcial = fc.oneof(
  fechaIso,
  fechaIso.map((f) => f.slice(0, 7)),
  fechaIso.map((f) => f.slice(0, 4)),
  fc.constant(undefined),
);
const entrada = fc.record({
  fechaComprobacion: fechaParcial,
  tieneHorario: fc.boolean(),
  hoy: fechaIso,
  casada: fc.boolean(),
  posibleCierre: fc.boolean(),
});

const DIA_MS = 86_400_000;
const dias = (desde: string, hasta: string) => (Date.parse(hasta) - Date.parse(desde)) / DIA_MS;

describe("invariantes de procedenciaHorario", () => {
  it("con más de 730 días o sin fecha ofrece el botón si la parada está casada, y nunca si no lo está", () => {
    fc.assert(
      fc.property(entrada, (e) => {
        const r = procedenciaHorario(e);
        if (!e.casada) return r.ofrecerGoogle === false;
        const inicio = e.fechaComprobacion ? `${e.fechaComprobacion}${e.fechaComprobacion.length === 4 ? "-01-01" : e.fechaComprobacion.length === 7 ? "-01" : ""}` : null;
        const antiguo = inicio === null || dias(inicio, e.hoy) > 730;
        return antiguo ? r.ofrecerGoogle === true : r.ofrecerGoogle === e.posibleCierre;
      }),
    );
  });

  it("todo aviso del catálogo y todo aviso producido dicen «puede» y nombran OpenStreetMap", () => {
    const delCatalogo = Object.entries(TEXTOS_HORARIO)
      .filter(([clave]) => clave.startsWith("aviso"))
      .map(([, texto]) => texto.texto);
    expect(delCatalogo.length).toBeGreaterThan(0);
    const producidos: string[] = [];
    fc.assert(
      fc.property(entrada, (e) => {
        const { aviso } = procedenciaHorario(e);
        if (aviso) producidos.push(aviso);
      }),
    );
    for (const aviso of [...delCatalogo, ...producidos]) {
      expect(aviso).toContain("puede");
      expect(aviso).toContain("OpenStreetMap");
    }
  });

  it("el rótulo nunca afirma certeza: siempre nombra la fuente", () => {
    fc.assert(
      fc.property(entrada, (e) => {
        const { rotulo } = procedenciaHorario(e);
        return rotulo === null ? !e.tieneHorario : rotulo.includes("OpenStreetMap");
      }),
    );
  });
});
