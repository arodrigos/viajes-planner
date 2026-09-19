import { beforeEach, describe, expect, it } from "vitest";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { tick } from "@/lib/trabajador/tick";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function dobleContador(): EjecutorModelo & { llamadas: number } {
  const doble = {
    llamadas: 0,
    async invocar(): Promise<ResultadoInvocacion> {
      doble.llamadas += 1;
      return { texto: '{"dias": []}' };
    },
  };
  return doble;
}

// trabajador-ac3 (c): la exclusión mutua y el atajo de cola vacía se
// comprueban contra el cerrojo real de Postgres, no contra un mock en
// memoria — dos procesos de verdad no podrían compartir un mock.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("tick (trabajador-ac3)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    await supabase.from("trabajos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });

  it("con la cola vacía, completa rápido y sin invocar al modelo", async () => {
    const doble = dobleContador();
    const antes = Date.now();

    const resultado = await tick(supabase, { ejecutor: doble, directorio: "/tmp" });

    expect(Date.now() - antes).toBeLessThan(2000);
    expect(resultado.cerrojoAdquirido).toBe(true);
    expect(resultado.trabajosProcesados).toBe(0);
    expect(doble.llamadas).toBe(0);
  });

  // esqueleto-ac1: /api/salud lee la fila 'trabajador-vps1' más reciente de
  // `salud` para trabajador.visto_hace_seg; esto prueba que tick() la deja
  // de verdad, contra Postgres real, no que el código "debería" escribirla.
  it("deja constancia de vida en `salud` aunque la cola esté vacía", async () => {
    const antes = new Date().toISOString();

    await tick(supabase, { ejecutor: dobleContador(), directorio: "/tmp" });

    const { data, error } = await supabase
      .from("salud")
      .select("origen, registrado_en")
      .eq("origen", "trabajador-vps1")
      .order("registrado_en", { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.origen).toBe("trabajador-vps1");
    expect(data?.registrado_en >= antes).toBe(true);
  });

  it("dos ticks a la vez: exactamente uno adquiere el cerrojo y arranca", async () => {
    const dobleA = dobleContador();
    const dobleB = dobleContador();

    const [a, b] = await Promise.all([
      tick(supabase, { ejecutor: dobleA, directorio: "/tmp", tomadoPor: "tick-a" }),
      tick(supabase, { ejecutor: dobleB, directorio: "/tmp", tomadoPor: "tick-b" }),
    ]);

    const adquiridos = [a, b].filter((r) => r.cerrojoAdquirido);
    expect(adquiridos).toHaveLength(1);
  });
});
