import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idsExternosVisitados } from "@/lib/plan/visitas";
import { ErrorLecturaPlan, recuperarPlan } from "@/lib/plan/repositorio";

interface Consulta {
  tabla: string;
  columnas: string;
  filtrosIn: Array<{ columna: string; valores: unknown[] }>;
}

// Cliente que responde por tabla y apunta cada `.in(...)`: lo que se comprueba
// es el tamaño de la petición, que la ida y vuelta real ya cubre el job de
// integración.
function clienteFalso(respuestas: Record<string, { data: unknown; error: { message: string } | null }>) {
  const consultas: Consulta[] = [];
  const cliente = {
    from(tabla: string) {
      const consulta: Consulta = { tabla, columnas: "", filtrosIn: [] };
      consultas.push(consulta);
      const builder: Record<string, unknown> = {
        select: (columnas: string) => ((consulta.columnas = columnas), builder),
        in: (columna: string, valores: unknown[]) => (consulta.filtrosIn.push({ columna, valores }), builder),
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => builder,
        then: (resolver: (v: unknown) => unknown) => resolver(respuestas[tabla] ?? { data: [], error: null }),
      };
      return builder;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

describe("idsExternosVisitados: la petición no crece con las paradas", () => {
  it("propiedad: cuantas más versiones y visitas haya, los valores de cada .in son solo ids de versión", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 30 }), async (versiones, externos) => {
        const { cliente, consultas } = clienteFalso({
          plan_versiones: { data: Array.from({ length: versiones }, (_, i) => ({ id: `v${i}` })), error: null },
          visitas: { data: externos.map((id_externo) => ({ paradas: { id_externo } })), error: null },
        });
        const visitados = await idsExternosVisitados(cliente, "p1");
        expect(visitados).toEqual(new Set(externos));
        const valoresEnUrl = consultas.flatMap((c) => c.filtrosIn).reduce((suma, f) => suma + f.valores.length, 0);
        expect(valoresEnUrl).toBeLessThanOrEqual(versiones);
      }),
    );
  });

  it("acepta la relación embebida como objeto o como lista de un elemento", async () => {
    const { cliente } = clienteFalso({
      plan_versiones: { data: [{ id: "v1" }], error: null },
      visitas: { data: [{ paradas: { id_externo: "a" } }, { paradas: [{ id_externo: "b" }] }], error: null },
    });
    expect(await idsExternosVisitados(cliente, "p1")).toEqual(new Set(["a", "b"]));
  });
});

describe("recuperarPlan: el error dice en qué paso falló", () => {
  const plan = { data: { id: "p1", destino: "Lisboa", ciudad: null }, error: null };
  const version = { data: [{ id: "v1", version: 1, personas: 2, dias: [], avisos: [], recomendaciones: [] }], error: null };

  it.each([
    ["planes", { planes: { data: null, error: { message: "boom" } } }, "plan"],
    ["plan_versiones", { planes: plan, plan_versiones: { data: null, error: { message: "boom" } } }, "version"],
    ["paradas", { planes: plan, plan_versiones: version, paradas: { data: null, error: { message: "boom" } } }, "paradas"],
    ["paradas_alternativas", { planes: plan, plan_versiones: version, paradas: { data: [{ id: "x" }], error: null }, paradas_alternativas: { data: null, error: { message: "boom" } } }, "alternativas"],
    ["visitas", { planes: plan, plan_versiones: version, paradas: { data: [], error: null }, visitas: { data: null, error: { message: "boom" } } }, "visitas"],
  ])("fallo en %s → paso %s", async (_tabla, respuestas, paso) => {
    const { cliente } = clienteFalso(respuestas as Record<string, { data: unknown; error: { message: string } | null }>);
    const fallo = await recuperarPlan(cliente, "p1").catch((e: unknown) => e);
    expect(fallo).toBeInstanceOf(ErrorLecturaPlan);
    expect((fallo as ErrorLecturaPlan).paso).toBe(paso);
  });
});
