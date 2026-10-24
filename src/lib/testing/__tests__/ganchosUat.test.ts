// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { diaParaConflictos } from "@/app/plan/[id]/conflictosVista";
import type { DiaPublico } from "@/app/plan/[id]/tiposVista";
import { evaluarDia } from "@/lib/plan/conflictos";
import { forzarHorarioParada, horariosForzados, instalarGanchosUat, reiniciarHorariosForzados, suscribirHorariosForzados } from "../ganchosUat";

afterEach(() => {
  reiniciarHorariosForzados();
  delete (window as { __debug?: unknown }).__debug;
});

// 2026-10-26 es lunes.
const dia: DiaPublico = {
  fecha: "2026-10-26",
  franjas: [{ id: "manana", etiqueta: "Mañana" }],
  paradas: [
    {
      id: "a",
      franja_id: "manana",
      nombre: "A",
      descripcion: "",
      procedencia: { fuente: "osm" },
      duracion_min: 60,
      coordenadas: { lat: 38.7, lon: -9.1 },
      horario: { inicio: "10:00", fin: "11:00", recortada: false, apertura: "", fuenteOsm: { regla: "Mo-Su 09:00-20:00" }, minutos: { inicio: 600, fin: 660, franjaDesde: 540, franjaHasta: 780 } },
    },
  ],
} as unknown as DiaPublico;

const evaluar = () => {
  const { dia: d, horarios } = diaParaConflictos(dia, horariosForzados());
  return evaluarDia(d, { opciones: { perfil: null }, horarios });
};

describe("forzarHorarioParada (ape-ac3)", () => {
  it("sin ?pruebas=1 el gancho no existe", () => {
    window.history.pushState({}, "", "/plan/x");
    instalarGanchosUat();
    expect((window as { __debug?: unknown }).__debug).toBeUndefined();
  });

  it("con ?pruebas=1 se expone y cambia el resultado sin tocar el servidor", () => {
    const fetchEspia = vi.spyOn(globalThis, "fetch");
    window.history.pushState({}, "", "/plan/x?pruebas=1");
    instalarGanchosUat();
    const debug = (window as unknown as { __debug: { forzarHorarioParada: typeof forzarHorarioParada } }).__debug;
    expect(evaluar().conflictos).toHaveLength(0);
    debug.forzarHorarioParada({ paradaId: "a", opening_hours: "Mo off; Tu-Su 10:00-18:00" });
    expect(evaluar().conflictos.map((c) => c.texto)).toEqual(["Cerrado el lunes"]);
    debug.forzarHorarioParada({ paradaId: "a", opening_hours: 'Mo-Su 10:00-18:00 "por cita"' });
    const r = evaluar();
    expect(r.conflictos).toHaveLength(0);
    expect(r.sinConfirmar).toEqual(["a"]);
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("avisa a los suscriptores y el estado sobrevive entre llamadas", () => {
    const oyente = vi.fn();
    const baja = suscribirHorariosForzados(oyente);
    forzarHorarioParada({ paradaId: "a", opening_hours: "Mo off", check_date: "2025-01-01" });
    expect(oyente).toHaveBeenCalledTimes(1);
    expect(horariosForzados().a).toEqual({ opening_hours: "Mo off", check_date: "2025-01-01" });
    baja();
  });
});
