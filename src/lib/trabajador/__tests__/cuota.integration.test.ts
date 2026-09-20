import { beforeEach, describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { procesarTrabajo } from "@/lib/trabajador/procesarTrabajo";
import { tick } from "@/lib/trabajador/tick";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

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

// trabajador-ac6: la caducidad de reintento_no_antes_de y de tomado_hasta
// la compara la RPC contra el now() real de Postgres, así que ningún reloj
// de este proceso puede adelantarlo — y supabase/ está congelado por
// trabajador-ac5(c), así que tampoco es opción moverlo desde la RPC. Lo que
// sí está bajo control del test es qué instante queda ESCRITO: en vez de
// esperar tiempo real a que un plazo futuro se cumpla (la carrera que tumbó
// este test en CI), se escribe directamente el instante ya vencido que un
// reloj real habría dejado — con margen de horas, no de milisegundos, e
// indistinguible para la RPC de uno al que de verdad le hubiera dado
// tiempo de pasar.
function dentroDeHoras(horas: number): string {
  return new Date(Date.now() + horas * 3_600_000).toISOString();
}

function haceHoras(horas: number): string {
  return new Date(Date.now() - horas * 3_600_000).toISOString();
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
  const supabase = clienteDePrueba();

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

  // "Adelanta el reloj" del trabajo: sobrescribe su plazo de reintento y su
  // arrendamiento (si lo tenía) con instantes ya vencidos, sin esperar nada
  // real. Es la misma siembra directa que ya usa este fichero para la fila
  // envenenada, aplicada esta vez a los campos que la RPC compara con
  // now() — no un mock del comportamiento del sistema, sino del paso del
  // tiempo que ese comportamiento necesita para activarse.
  async function vencerPlazos(id: string): Promise<void> {
    await supabase
      .from("trabajos")
      .update({ reintento_no_antes_de: haceHoras(1), tomado_hasta: haceHoras(1) })
      .eq("id", id);
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

  it("(ac6) recuperación encadenada: sobrevive a la fila envenenada, no libera antes de tiempo, y aguanta dos límites seguidos sin limpiar entre medias ni depender de tiempo real transcurrido", async () => {
    // (1) Se siembra a propósito la fila que hoy causa el bloqueo
    // permanente: used_percentage 100 con resets_at vencido hace 24 horas.
    // Con el pre-chequeo retirado esta fila ya no tiene ningún lector; la
    // aserción final comprueba que sigue intacta al terminar.
    await supabase.from("uso_suscripcion").insert({
      familia: "sonnet",
      ventana: "seven_day",
      used_percentage: 100,
      resets_at: haceHoras(24),
    });
    const trabajoId = await crearTrabajo();

    // (2) Primer límite, con una hora de reinicio genuinamente futura (2h
    // vista, no milisegundos): se ejercita procesarTrabajo directamente
    // porque este paso no reclama el trabajo por la cola, solo prueba que
    // invocarOPausar escribe exactamente la hora que dio el modelo.
    const primerReset = dentroDeHoras(2);
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

    // (3) Tick inmediato: reintento_no_antes_de sigue a dos horas vista de
    // verdad, así que la RPC no debe devolver el trabajo. La comprobación
    // es instantánea contra un instante realmente futuro -- no depende de
    // cuánto tarde esta máquina, así que no necesita esperar nada.
    const dobleNoDeberiaLlamarse = dobleFijo([DIAS_VALIDOS]);
    const tickInmediato = await tick(supabase, {
      ejecutor: dobleNoDeberiaLlamarse,
      directorio: "/tmp",
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(tickInmediato.trabajosProcesados).toBe(0);
    expect(dobleNoDeberiaLlamarse.invocaciones).toBe(0);

    // (4) Se vence el primer plazo sin esperar tiempo real (ver
    // vencerPlazos): el trabajo pasa a ser reclamable para la RPC tal y
    // como lo habría dejado un reloj real dos horas después.
    await vencerPlazos(trabajoId);

    // (5) Tick de recuperación: la RPC reclama el trabajo porque su plazo
    // ya venció (fija su propio tomado_hasta) y lo procesa; el doble lanza
    // un SEGUNDO límite con una hora nueva, y el trabajo vuelve a quedar
    // pausado con ESA hora, no con la primera. Es la propia RPC, no el
    // test, quien decide que el trabajo ya es reclamable.
    const segundoReset = dentroDeHoras(1);
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

    // (6) Se vencen el segundo plazo Y el arrendamiento (tomado_hasta) que
    // dejó el tick anterior, otra vez por escritura directa: los diez
    // minutos de arrendamiento por defecto de tomar_siguiente_trabajo
    // pertenecen a cola-y-acceso (bloque aprobado, no se toca), y esperarlos
    // de verdad le costaría minutos reales a cada corrida de CI.
    await vencerPlazos(trabajoId);

    // (7) Tick que cierra la recuperación -- por un tick real, no por una
    // llamada directa a procesarTrabajo, para que sea la propia RPC quien
    // demuestre que el trabajo vuelve a ser reclamable tras el segundo
    // límite.
    const dobleFinal = dobleFijo([DIAS_VALIDOS]);
    const tickFinal = await tick(supabase, {
      ejecutor: dobleFinal,
      directorio: "/tmp",
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(tickFinal.trabajosProcesados).toBe(1);
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
