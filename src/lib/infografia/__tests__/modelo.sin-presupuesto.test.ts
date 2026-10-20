import { describe, expect, it } from "vitest";
import { construirModeloInfografia } from "@/lib/infografia/modelo";
import type { Plan } from "@/lib/plan/tipos";

const plan: Plan = {
  id: "p",
  version: 1,
  destino: "Toledo",
  personas: 2,
  dias: [{ fecha: "2027-03-05", franjas: [{ id: "m", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }], paradas: [{ id: "a", franja_id: "m", nombre: "Catedral", descripcion: "", duracion_min: 90, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" }, coste: { importe_eur: 12, por: "persona", procedencia: "estimado", fecha: "2026-10-01" } }] }],
};

describe("construirModeloInfografia sin presupuesto (cmd-ac6)", () => {
  it("la lámina del miembro no lleva totales de dinero", () => {
    const modelo = construirModeloInfografia(plan, 4000, { sinPresupuesto: true });
    expect(modelo.totales).toEqual({ dias: 1, sitios: 1, km_traslado: 0 });
    expect(JSON.stringify(modelo)).not.toMatch(/4000|4\.000|presupuesto/i);
  });

  it("la del dueño sigue llevando el total y su presupuesto", () => {
    const modelo = construirModeloInfografia(plan, 4000);
    expect(modelo.totales.tu_presupuesto_eur).toBe(4000);
    expect(modelo.totales.texto_presupuesto).toMatch(/de 4\.000/);
  });
});
