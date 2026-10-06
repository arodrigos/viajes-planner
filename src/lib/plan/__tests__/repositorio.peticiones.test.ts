import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarPlan } from "@/lib/plan/repositorio";
import { planGrande } from "@/lib/plan/__fixtures__/plan-grande";

// Cliente mínimo que cuenta una petición por cada consulta que se espera
// (await). Es solo un contador: la ida y vuelta real contra Postgres está en
// guardarPlan.integration.test.ts.
function clienteContador() {
  const peticiones: string[] = [];
  const insertadas: Record<string, unknown[]> = {};
  const cliente = {
    from(tabla: string) {
      let operacion = "select";
      let filas: unknown = null;
      const consulta: Record<string, unknown> = {
        upsert: (f: unknown) => ((operacion = "upsert"), (filas = f), consulta),
        insert: (f: unknown) => ((operacion = "insert"), (filas = f), consulta),
        select: () => consulta,
        eq: () => consulta,
        order: () => consulta,
        limit: () => consulta,
        single: () => consulta,
        then: (resolver: (v: unknown) => unknown) => {
          peticiones.push(`${operacion} ${tabla}`);
          if (operacion === "insert") (insertadas[tabla] ??= []).push(...(Array.isArray(filas) ? filas : [filas]));
          const data = tabla === "plan_versiones" ? (operacion === "insert" ? { id: "v1" } : []) : null;
          return resolver({ data, error: null });
        },
      };
      return consulta;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, peticiones, insertadas };
}

describe("guardarPlan: peticiones constantes (alr-ac1)", () => {
  it("un plan del tamaño del de Londres hace ≤ 6 peticiones y una sola por tabla", async () => {
    const { cliente, peticiones } = clienteContador();
    await guardarPlan(cliente, planGrande("p1"));
    expect(peticiones.length).toBeLessThanOrEqual(6);
    expect(peticiones.filter((p) => p === "insert paradas_alternativas")).toHaveLength(1);
    expect(peticiones.filter((p) => p === "insert paradas")).toHaveLength(1);
  });

  it("sin alternativas no hay inserción vacía en paradas_alternativas; con 1 parada, ≤ 6", async () => {
    const { cliente, peticiones } = clienteContador();
    await guardarPlan(cliente, planGrande("p2", 1, 1, 0));
    expect(peticiones.length).toBeLessThanOrEqual(6);
    expect(peticiones.some((p) => p.includes("paradas_alternativas"))).toBe(false);
  });

  it("propiedad: para cualquier tamaño, ≤ 6 peticiones y cada alternativa apunta a una parada insertada", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 5 }), async (dias, paradas, alternativas) => {
        const { cliente, peticiones, insertadas } = clienteContador();
        await guardarPlan(cliente, planGrande("pp", dias, paradas, alternativas));
        expect(peticiones.length).toBeLessThanOrEqual(6);
        const idsParadas = new Set((insertadas.paradas ?? []).map((f) => (f as { id: string }).id));
        expect(idsParadas.size).toBe(dias * paradas);
        for (const alt of insertadas.paradas_alternativas ?? []) {
          expect(idsParadas.has((alt as { parada_id: string }).parada_id)).toBe(true);
        }
      }),
      { numRuns: 30 },
    );
  });
});
