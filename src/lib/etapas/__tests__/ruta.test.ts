import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import type { Dia, EtapaPlan, Plan, TrasladoPlan } from "@/lib/plan/tipos";
import { calcularRuta, formatearDuracion, textoTraslado } from "../ruta";

const etapa = (nombre: string, dia_inicio: number, dias: number, noche: number): EtapaPlan => ({
  ciudad: { estado: "resuelta", nombre, intentado_en: "2026-10-05" },
  pais: "Portugal",
  dias,
  dia_inicio,
  alojamiento_noche_eur: noche,
  zona: 0,
  ajustes: [],
});

const dia = (fecha: string, coste: number): Dia =>
  ({ fecha, franjas: [], paradas: [{ id: fecha, franja_id: "m", nombre: "x", descripcion: "", coste: { importe_eur: coste, por: "grupo", procedencia: "estimado" } }] }) as unknown as Dia;

describe("calcularRuta (cp-etv-01)", () => {
  it("Portugal 8 días: Lisboa 4 noches, Oporto 3, total 919 €", () => {
    const dias = Array.from({ length: 8 }, (_, i) => dia(`2027-06-${String(8 + i).padStart(2, "0")}`, 30));
    const traslado: TrasladoPlan = { desde: "Lisboa", hasta: "Oporto", modo: "autobus", distancia_km: 313, duracion_min: 229, coste_eur: 79, procedencia: "estimado" };
    const etapas = [etapa("Lisboa", 0, 4, 90), etapa("Oporto", 4, 4, 80)];
    const ruta = calcularRuta({ personas: 4, dias, etapas, traslados: [traslado] });
    expect(ruta.etapas.map((e) => [e.ciudad, e.noches])).toEqual([["Lisboa", 4], ["Oporto", 3]]);
    expect(ruta.etapas[1].fecha_llegada).toBe("2027-06-12");
    expect(ruta.suma_visible_eur).toBe(919);
    expect(textoTraslado(traslado)).toBe("Lisboa → Oporto · autobús · ~3 h 49 min · ~79 € (estimado)");
  });

  it("formatea duraciones", () => {
    expect([formatearDuracion(45), formatearDuracion(120), formatearDuracion(229)]).toEqual(["45 min", "2 h", "3 h 49 min"]);
  });

  it("en modo época no hay fechas", () => {
    const ruta = calcularRuta({ personas: 2, dias: [dia("Día 1", 0), dia("Día 2", 0)], etapas: [etapa("Lisboa", 0, 2, 50)] });
    expect(ruta.etapas[0].fecha_inicio).toBeUndefined();
    expect(ruta.etapas[0].fecha_llegada).toBeUndefined();
  });

  it("invariante: la suma visible coincide con el total de calcularPresupuesto", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.double({ min: 0, max: 400, noNaN: true }).map((n) => Math.round(n * 100) / 100), { minLength: 5, maxLength: 5 }),
        fc.array(fc.double({ min: 0, max: 300, noNaN: true }).map((n) => Math.round(n * 100) / 100), { minLength: 5, maxLength: 5 }),
        fc.integer({ min: 1, max: 6 }),
        (duraciones, precios, costes, personas) => {
          let inicio = 0;
          const etapas = duraciones.map((d, i) => {
            const e = etapa(`C${i}`, inicio, d, precios[i]);
            inicio += d;
            return e;
          });
          const dias = Array.from({ length: inicio }, (_, i) => dia(`2027-07-${String(i + 1).padStart(2, "0")}`, costes[i % 5]));
          const traslados = etapas.slice(1).map((_, i): TrasladoPlan => ({ desde: `C${i}`, hasta: `C${i + 1}`, modo: "tren", distancia_km: 100, duracion_min: 90, coste_eur: costes[i], procedencia: "estimado" }));
          const ruta = calcularRuta({ personas, dias, etapas, traslados });
          const total = calcularPresupuesto({ personas, dias, etapas, traslados } as Pick<Plan, "personas" | "dias" | "etapas" | "traslados">).total_eur;
          expect(Math.round(ruta.suma_visible_eur * 100)).toBe(Math.round(total * 100));
        },
      ),
    );
  });
});
