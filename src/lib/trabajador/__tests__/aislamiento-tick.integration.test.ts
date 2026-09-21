import { beforeEach, describe, expect, it } from "vitest";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { adquirirCerrojo, liberarCerrojo } from "@/lib/trabajador/cerrojo";
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

  // Reescrito (issue #151): la versión anterior lanzaba dos tick() con
  // Promise.all y esperaba que "exactamente uno" ganase la carrera contra
  // Postgres real. La exclusión que da el UPDATE ... WHERE atómico de
  // adquirir_cerrojo_trabajador es real, pero DOS peticiones HTTP disparadas
  // "a la vez" desde Node no llegan garantizadamente a la vez a PostgREST:
  // el orden de entrega, no la base de datos, es lo que decidía el
  // resultado, y esa carrera de tiempos ya puso este test en rojo en CI más
  // de una vez sin que el producto estuviera roto. La propiedad que importa
  // -que un cerrojo ya tomado no se puede volver a tomar- no necesita dos
  // llamadas concurrentes para comprobarse: basta con tomarlo de verdad
  // contra Postgres, dejarlo tomado, e intentar tomarlo otra vez mientras
  // sigue tomado. Sigue siendo el cerrojo real, nunca un mock en memoria.
  it("con el cerrojo ya tomado por otro proceso, tick no lo adquiere ni invoca al modelo", async () => {
    const tomadoExternamente = await adquirirCerrojo(supabase, "tick-externo");
    expect(tomadoExternamente).toBe(true);

    const doble = dobleContador();
    const resultado = await tick(supabase, { ejecutor: doble, directorio: "/tmp", tomadoPor: "tick-b" });

    expect(resultado.cerrojoAdquirido).toBe(false);
    expect(resultado.trabajosProcesados).toBe(0);
    expect(doble.llamadas).toBe(0);

    // Liberado el cerrojo externo, un tick real vuelve a poder tomarlo: la
    // exclusión no lo deja huérfano.
    await liberarCerrojo(supabase, "tick-externo");
    const trasLiberar = await tick(supabase, { ejecutor: dobleContador(), directorio: "/tmp", tomadoPor: "tick-c" });
    expect(trasLiberar.cerrojoAdquirido).toBe(true);
  });
});
