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

// Postgres devuelve timestamptz con su propio formato ('+00:00', sin ceros
// finales de milisegundos) en vez del 'Z' de Date.toISOString(); comparar
// el instante, no la representación en texto, es lo correcto contra una
// base de datos real.
function mismoInstante(a: string | null | undefined, b: string): void {
  expect(a).toBeTruthy();
  expect(new Date(a as string).getTime()).toBe(new Date(b).getTime());
}

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
      // trabajador-ac5: el modo headless no publica el porcentaje consumido
      // — el doble representa esa realidad con null, no con un 100 inventado.
      throw new LimiteDeUsoAlcanzado(resetsAt, null);
    },
  };
  return doble;
}

// trabajador-ac5(b): comprobación de tipos en compilación (tsc --noEmit),
// no en runtime — nunca se llama. Si alguien le devuelve a usedPercentage
// un valor por defecto que finja ser siempre un número, esta asignación
// deja de necesitar el @ts-expect-error y "tsc --noEmit" falla con
// "Unused '@ts-expect-error' directive", que es justo la señal de que el
// 100 fabricado ha vuelto a colarse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _tipoUsedPercentageEsNullable(resetsAt: string): number {
  const limite = new LimiteDeUsoAlcanzado(resetsAt, null);
  // @ts-expect-error usedPercentage es number | null: asignarlo directamente a number debe fallar.
  const comoNumero: number = limite.usedPercentage;
  return comoNumero;
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("cuota de suscripción (trabajador-ac4, ac5, ac6)", () => {
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

  async function leerTrabajo(id: string) {
    const { data } = await supabase
      .from("trabajos")
      .select("estado, motivo, reintento_no_antes_de, plan_id")
      .eq("id", id)
      .single();
    return data;
  }

  it("(ac4) con la cuota semanal sembrada al 100% y VIGENTE, el trabajador invoca igualmente: el freno preventivo ya no existe", async () => {
    // used_percentage 100 con resets_at todavía por delante es exactamente
    // el estado que hoy, con el pre-chequeo en pie, pausaría cualquier
    // trabajo sin invocar nunca al modelo.
    await supabase.from("uso_suscripcion").insert({
      familia: "sonnet",
      ventana: "seven_day",
      used_percentage: 100,
      resets_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    });
    await crearTrabajo();

    const doble = dobleFijo([DIAS_VALIDOS]);
    const resultado = await tick(supabase, { ejecutor: doble, directorio: "/tmp", esperaOciosaMs: 0, intervaloOciosoMs: 10 });

    // Si el pre-chequeo siguiera vivo, tick() habría pausado el trabajo sin
    // invocar el doble ni una vez: invocaciones se habría quedado en 0 y el
    // trabajo no habría llegado nunca a 'completado', que es la única forma
    // de que pase por aquí sin haber pasado por 'pausado-por-cuota'.
    expect(resultado.trabajosProcesados).toBe(1);
    expect(doble.invocaciones).toBe(1);
  });

  it("(ac5) al chocar con el límite no se fabrica ningún porcentaje: uso_suscripcion no gana filas y el esquema de la tabla no cambia", async () => {
    const trabajoId = await crearTrabajo();
    const resetsAt = new Date(Date.now() + 7_200_000).toISOString();
    const doble = dobleLimitado(resetsAt);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("pausado-por-cuota");
    const { count } = await supabase.from("uso_suscripcion").select("id", { count: "exact", head: true });
    expect(count).toBe(0);

    const trabajo = await leerTrabajo(trabajoId);
    expect(trabajo?.estado).toBe("pausado-por-cuota");
    expect(trabajo?.motivo).toBeTruthy();
    mismoInstante(trabajo?.reintento_no_antes_de, resetsAt);
  });

  it("(ac6) recuperación encadenada: sobrevive a la fila envenenada, no libera antes de tiempo, y aguanta dos límites seguidos sin limpiar entre medias", async () => {
    // (1) Se siembra a propósito la fila que hoy causa el bloqueo
    // permanente: used_percentage 100 con resets_at vencido hace 24 horas.
    // Con el pre-chequeo retirado esta fila ya no tiene ningún lector; la
    // aserción final comprueba que sigue intacta al terminar.
    await supabase.from("uso_suscripcion").insert({
      familia: "sonnet",
      ventana: "seven_day",
      used_percentage: 100,
      resets_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    });
    const trabajoId = await crearTrabajo();

    // La caducidad la compara Postgres con su propio now() dentro de la RPC
    // tomar_siguiente_trabajo, no un reloj de este proceso: no hay forma de
    // "adelantar" ese reloj desde el test. En vez de esperar horas reales,
    // se usan horas de reinicio a milisegundos vista y se espera de verdad
    // ese margen — sigue siendo tiempo real transcurrido, solo que corto.
    const primerReset = new Date(Date.now() + 150).toISOString();
    const dobleLimite1 = dobleLimitado(primerReset);
    const resultado1 = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: dobleLimite1, directorio: "/tmp" },
    );
    expect(resultado1.estado).toBe("pausado-por-cuota");
    let trabajo = await leerTrabajo(trabajoId);
    expect(trabajo?.estado).toBe("pausado-por-cuota");
    mismoInstante(trabajo?.reintento_no_antes_de, primerReset);
    expect(trabajo?.plan_id).toBeNull();

    // (2) Tick inmediato, sin dejar pasar la hora de reinicio: la RPC no
    // debe devolver el trabajo, así que el doble no se invoca.
    const dobleNoDeberiaLlamarse = dobleFijo([DIAS_VALIDOS]);
    const tickInmediato = await tick(supabase, {
      ejecutor: dobleNoDeberiaLlamarse,
      directorio: "/tmp",
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(tickInmediato.trabajosProcesados).toBe(0);
    expect(dobleNoDeberiaLlamarse.invocaciones).toBe(0);

    // (3) Pasada la primera hora de reinicio, un tick real lo retoma SOLO
    // por la cola —esta es la única reclamación de arrendamiento de todo el
    // test, a propósito: tomar_siguiente_trabajo fija tomado_hasta a
    // ARRENDAMIENTO_MIN (10 minutos por defecto, cola-y-acceso, fuera de
    // alcance de este bloque) y pausarPorCuota no lo toca —corrección 3, no
    // se cambia más allá de lo que exige la corrección 1—, así que una
    // segunda reclamación real quedaría bloqueada por ese arrendamiento
    // muchos minutos después de que expire reintento_no_antes_de. Encadenar
    // aquí el SEGUNDO límite, dentro de esta misma reclamación, prueba a la
    // vez la recuperación real vía RPC y que aguanta dos límites seguidos.
    const segundoReset = new Date(Date.now() + 150).toISOString();
    const dobleLimite2 = dobleLimitado(segundoReset);
    const tickRecuperacion = await tick(supabase, {
      ejecutor: dobleLimite2,
      directorio: "/tmp",
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(tickRecuperacion.trabajosProcesados).toBe(1);
    expect(dobleLimite2.invocaciones).toBe(1);
    trabajo = await leerTrabajo(trabajoId);
    expect(trabajo?.estado).toBe("pausado-por-cuota");
    mismoInstante(trabajo?.reintento_no_antes_de, segundoReset);

    // (4) Pasada la segunda hora de reinicio, el trabajo se completa sin
    // que nadie intervenga. Se ejercita procesarTrabajo directamente —la
    // misma función que tick() invoca internamente tras reclamar— en vez
    // de un tercer tick(), para no esperar a que expire el arrendamiento de
    // 10 minutos fijado en el paso (3); eso pertenece a cola-y-acceso, ya
    // aprobado, y no lo reabre este bloque.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const dobleFinal = dobleFijo([DIAS_VALIDOS]);
    const resultadoFinal = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: trabajo?.plan_id ?? null, criterios: CRITERIOS },
      { ejecutor: dobleFinal, directorio: "/tmp" },
    );
    expect(resultadoFinal.estado).toBe("completado");
    expect(dobleFinal.invocaciones).toBe(1);
    trabajo = await leerTrabajo(trabajoId);
    expect(trabajo?.estado).toBe("completado");
    expect(trabajo?.plan_id).toBeTruthy();

    // La fila envenenada del paso (1) sigue en uso_suscripcion: la
    // recuperación ocurrió CON ella presente, que es lo que demuestra que
    // ya no puede bloquear nada.
    const { data: envenenada } = await supabase
      .from("uso_suscripcion")
      .select("id")
      .eq("familia", "sonnet")
      .eq("used_percentage", 100)
      .lt("resets_at", new Date().toISOString());
    expect(envenenada?.length ?? 0).toBeGreaterThan(0);
  });
});
