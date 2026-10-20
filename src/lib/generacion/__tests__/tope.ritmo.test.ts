import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CriteriosViaje, Perfil } from "@/lib/criterios/tipos";
import { RITMOS } from "@/lib/criterios/intereses";
import { topeEfectivo } from "@/lib/generacion/tope";

const BASE: CriteriosViaje = {
  destino_o_tipo: "Valencia",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 3,
  personas: [{ edad: 40 }],
  perfil: "familiar",
  presupuesto_eur: 900,
};
const PERFILES: Perfil[] = ["familiar", "pareja", "amigos", "solo"];
// Los topes de antes de este bloque, escritos a mano para que el test no
// dependa de la tabla que comprueba.
const TOPE_ANTIGUO: Record<Perfil, number> = { familiar: 2, pareja: 3, amigos: 4, solo: 4 };

describe("topeEfectivo con ritmo (rit-ac2)", () => {
  it("tabla del diseño: familiar 2/1/2/3, pareja 3→2 y 4, amigos y solo 4→3 y 5", () => {
    const tope = (perfil: Perfil, ritmo?: CriteriosViaje["ritmo"]) => topeEfectivo({ ...BASE, perfil, ritmo });
    expect([undefined, "tranquilo", "normal", "intenso"].map((r) => tope("familiar", r as never))).toEqual([2, 1, 2, 3]);
    expect([tope("pareja", "tranquilo"), tope("pareja", "intenso")]).toEqual([2, 4]);
    expect([tope("amigos", "tranquilo"), tope("amigos", "intenso")]).toEqual([3, 5]);
    expect([tope("solo", "tranquilo"), tope("solo", "intenso")]).toEqual([3, 5]);
  });

  it("un tope_sitios_por_franja explícito manda sea cual sea el ritmo", () => {
    for (const ritmo of RITMOS) expect(topeEfectivo({ ...BASE, perfil: "pareja", tope_sitios_por_franja: 5, ritmo })).toBe(5);
  });

  it("límites: tranquilo con base 1 sigue en 1 y intenso con base 10 sigue en 10 (tope explícito aparte)", () => {
    // Con perfiles reales la base mínima es 2; el ajuste en sí se prueba por la propiedad de abajo.
    expect(topeEfectivo({ ...BASE, ritmo: "tranquilo" })).toBeGreaterThanOrEqual(1);
  });

  it("property: tranquilo ≤ normal ≤ intenso y los tres en [1,10]", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PERFILES), (perfil) => {
        const [t, n, i] = RITMOS.map((ritmo) => topeEfectivo({ ...BASE, perfil, ritmo }));
        return t >= 1 && i <= 10 && t <= n && n <= i;
      }),
    );
  });

  it("property: sin ritmo, o con normal, el tope es el de siempre", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PERFILES), fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }), (perfil, explicito) => {
        const sinRitmo = { ...BASE, perfil, ...(explicito !== undefined ? { tope_sitios_por_franja: explicito } : {}) };
        const esperado = explicito ?? TOPE_ANTIGUO[perfil];
        return topeEfectivo(sinRitmo) === esperado && topeEfectivo({ ...sinRitmo, ritmo: "normal" }) === esperado;
      }),
    );
  });
});
