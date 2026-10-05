import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import { ensamblarYValidar } from "../procesarTrabajo";

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 1,
  personas: [{ edad: 8 }, { edad: 38 }, { edad: 36 }, { edad: 9 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};

const base = { franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 50, categoria: "monumento" };

// cp-mot-02: costes 15, 0, −3, "doce", 2500 y ausente; motivos válido,
// vacío, de 400 caracteres, válido, válido y ausente.
const RESPUESTA = JSON.stringify({
  dias: [
    {
      fecha: "2026-11-07",
      paradas: [
        { ...base, nombre: "A", coste_eur_persona: 15, motivo: "Patios y jardines que a los niños les encantan" },
        { ...base, nombre: "B", coste_eur_persona: 0, motivo: "" },
        { ...base, nombre: "C", coste_eur_persona: -3, motivo: "x".repeat(400) },
        { ...base, nombre: "D", coste_eur_persona: "doce", motivo: "Motivo válido" },
        { ...base, nombre: "E", coste_eur_persona: 2500, motivo: "Otro motivo válido" },
        { ...base, nombre: "F" },
      ],
    },
  ],
});

describe("ensamblarYValidar (mot-ac2)", () => {
  it("descarta costes y motivos inválidos sin invalidar el plan y el total sale de calcularPresupuesto", () => {
    const resultado = ensamblarYValidar(CRITERIOS, "plan-mot-ac2", RESPUESTA);
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    const paradas = resultado.plan.dias[0].paradas;
    expect(paradas.map((p) => p.coste !== undefined)).toEqual([true, true, false, false, false, false]);
    expect(paradas[0].coste).toMatchObject({ importe_eur: 15, por: "persona", procedencia: "estimado" });
    expect(paradas[1].coste).toMatchObject({ importe_eur: 0, por: "gratis" });
    expect(paradas.map((p) => p.motivo !== undefined)).toEqual([true, false, false, true, true, false]);

    const presupuesto = calcularPresupuesto(resultado.plan);
    expect(presupuesto.total_eur).toBe(60);
    expect(presupuesto.total_estimado_eur).toBe(60);
    expect(presupuesto.total_de_fuente_eur).toBe(0);
  });

  it("un plan sin ningún coste da total 0", () => {
    const sinCostes = JSON.stringify({ dias: [{ fecha: "2026-11-07", paradas: [{ ...base, nombre: "A" }] }] });
    const resultado = ensamblarYValidar(CRITERIOS, "plan-mot-ac2b", sinCostes);
    expect(resultado.valido).toBe(true);
    if (resultado.valido) expect(calcularPresupuesto(resultado.plan).total_eur).toBe(0);
  });
});
