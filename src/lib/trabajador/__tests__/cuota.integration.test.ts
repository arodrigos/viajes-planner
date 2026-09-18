import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { procesarTrabajo } from "@/lib/trabajador/procesarTrabajo";
import { tick } from "@/lib/trabajador/tick";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 5,
  personas: [{ edad: 8 }, { edad: 38 }, { edad: 36 }, { edad: 9 }],
  perfil: "familiar",
  presupuesto_eur: 2000,
};

const DIAS_VALIDOS = JSON.stringify({ dias: planFixture.dias });

function dobleFijo(respuestas: string[]): EjecutorModelo & { invocaciones: number } {
  const doble = {
    invocaciones: 0,
    async invocar(): Promise<ResultadoInvocacion> {
      const texto = respuestas[doble.invocaciones] ?? respuestas[respuestas.length - 1];
      doble.invocaciones += 1;
      return { texto };
    },
  };
  return doble;
}

function dobleLimitado(resetsAt: string): EjecutorModelo & { invocaciones: number } {
  const doble = {
    invocaciones: 0,
    async invocar(): Promise<ResultadoInvocacion> {
      doble.invocaciones += 1;
      throw new LimiteDeUsoAlcanzado(resetsAt);
    },
  };
  return doble;
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("cuota de suscripción (trabajador-ac4)", () => {
  const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");

  beforeEach(async () => {
    await supabase.from("uso_suscripcion").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("trabajos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
  });

  async function crearTrabajo() {
    const { data, error } = await supabase
      .from("trabajos")
      .insert({ tipo: "generacion", criterios: CRITERIOS })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);
    return data.id as string;
  }

  it("(a) al 85% con umbral 80 no invoca y queda pausado con motivo 'reserva-de-flota'; al 70% sí arranca", async () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    await supabase.from("uso_suscripcion").insert({ familia: "sonnet", ventana: "seven_day", used_percentage: 85, resets_at: resetsAt });

    const trabajoAlto = await crearTrabajo();
    const dobleAlto = dobleFijo([DIAS_VALIDOS]);
    const resultadoAlto = await procesarTrabajo(
      supabase,
      { id: trabajoAlto, plan_id: null, criterios: CRITERIOS },
      { ejecutor: dobleAlto, directorio: "/tmp" },
    );

    expect(resultadoAlto.estado).toBe("pausado-por-cuota");
    expect(dobleAlto.invocaciones).toBe(0);
    const { data: filaAlta } = await supabase
      .from("trabajos")
      .select("estado, motivo, reintento_no_antes_de")
      .eq("id", trabajoAlto)
      .single();
    expect(filaAlta?.estado).toBe("pausado-por-cuota");
    expect(filaAlta?.motivo).toBe("reserva-de-flota");
    expect(filaAlta?.reintento_no_antes_de).toBe(resetsAt);

    await supabase.from("uso_suscripcion").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("uso_suscripcion").insert({ familia: "sonnet", ventana: "seven_day", used_percentage: 70, resets_at: resetsAt });

    const trabajoBajo = await crearTrabajo();
    const dobleBajo = dobleFijo([DIAS_VALIDOS]);
    const resultadoBajo = await procesarTrabajo(
      supabase,
      { id: trabajoBajo, plan_id: null, criterios: CRITERIOS },
      { ejecutor: dobleBajo, directorio: "/tmp" },
    );

    expect(resultadoBajo.estado).toBe("completado");
    expect(dobleBajo.invocaciones).toBe(1);
  });

  it("(b) límite de uso a media invocación: pausado-por-cuota con la hora de reinicio exacta y sin plan parcial", async () => {
    const trabajoId = await crearTrabajo();
    const resetsAt = new Date(Date.now() + 7_200_000).toISOString();
    const doble = dobleLimitado(resetsAt);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("pausado-por-cuota");
    const { data: trabajo } = await supabase
      .from("trabajos")
      .select("estado, reintento_no_antes_de, plan_id")
      .eq("id", trabajoId)
      .single();
    expect(trabajo?.estado).toBe("pausado-por-cuota");
    expect(trabajo?.reintento_no_antes_de).toBe(resetsAt);
    expect(trabajo?.plan_id).toBeNull();

    // La lectura del límite queda registrada para el pre-chequeo del
    // próximo trabajo (ac4-a), cerrando el círculo entre (b) y (a).
    const { data: lectura } = await supabase
      .from("uso_suscripcion")
      .select("used_percentage, resets_at")
      .eq("familia", "sonnet")
      .eq("ventana", "seven_day")
      .single();
    expect(lectura?.resets_at).toBe(resetsAt);
  });

  it("(c) pasada la hora de reinicio, un tick posterior retoma y completa el trabajo pausado sin intervención", async () => {
    const resetsAt = new Date(Date.now() - 60_000).toISOString();
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({
        tipo: "generacion",
        criterios: CRITERIOS,
        estado: "pausado-por-cuota",
        motivo: "reserva-de-flota",
        reintento_no_antes_de: resetsAt,
      })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const doble = dobleFijo([DIAS_VALIDOS]);
    const resultado = await tick(supabase, { ejecutor: doble, directorio: "/tmp" });

    expect(resultado.trabajosProcesados).toBe(1);
    expect(doble.invocaciones).toBe(1);
    const { data: filaFinal } = await supabase.from("trabajos").select("estado").eq("id", trabajo.id).single();
    expect(filaFinal?.estado).toBe("completado");
  });
});
