import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { tomarSiguienteTrabajo } from "@/lib/cola/tomar";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("tomarSiguienteTrabajo (cola-ac2)", () => {
  const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");

  it("dos tomas concurrentes del mismo trabajo: exactamente una se lo lleva", async () => {
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({ tipo: "generacion", criterios: {} })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const [a, b] = await Promise.all([
      tomarSiguienteTrabajo(supabase, "worker-a"),
      tomarSiguienteTrabajo(supabase, "worker-b"),
    ]);

    const tomados = [a, b].filter((r) => r?.id === trabajo.id);
    expect(tomados).toHaveLength(1);
  });

  it("un trabajo con el arrendamiento vencido vuelve a ser tomable", async () => {
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({
        tipo: "generacion",
        criterios: {},
        estado: "en-curso",
        tomado_por: "worker-viejo",
        tomado_hasta: new Date(Date.now() - 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const resultado = await tomarSiguienteTrabajo(supabase, "worker-nuevo");
    expect(resultado?.id).toBe(trabajo.id);
  });

  it("sin trabajos disponibles, devuelve null", async () => {
    await supabase.from("trabajos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const resultado = await tomarSiguienteTrabajo(supabase, "worker-x");
    expect(resultado).toBeNull();
  });
});
