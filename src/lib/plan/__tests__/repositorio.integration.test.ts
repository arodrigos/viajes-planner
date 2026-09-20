import { beforeAll, describe, expect, it } from "vitest";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("persistencia del plan (persistencia-ac3)", () => {
  const supabase = clienteDePrueba();

  beforeAll(async () => {
    // Aislar el fixture de otras ejecuciones sobre la misma base local.
    await supabase.from("planes").delete().eq("id", planFixture.id);
  });

  it("guardar y recuperar devuelve el fixture idéntico, y recalcular no destruye la versión anterior", async () => {
    const { version: version1 } = await guardarPlan(supabase, planFixture);
    expect(version1).toBe(1);
    const recuperado = await recuperarPlan(supabase, planFixture.id);
    expect(recuperado).toEqual(planFixture);

    const planRecalculado: Plan = {
      ...planFixture,
      dias: planFixture.dias.map((dia, i) =>
        i === 0 ? { ...dia, paradas: dia.paradas.slice(0, 1) } : dia,
      ),
    };

    const { version: version2Numero } = await guardarPlan(supabase, planRecalculado);
    expect(version2Numero).toBe(2);

    const recuperadaV1 = await recuperarPlan(supabase, planFixture.id, 1);
    const recuperadaV2 = await recuperarPlan(supabase, planFixture.id, 2);

    expect(recuperadaV1).toEqual(planFixture);
    expect(recuperadaV2?.dias[0].paradas).toHaveLength(1);

    const ultima = await recuperarPlan(supabase, planFixture.id);
    expect(ultima?.version).toBe(2);
  });
});
