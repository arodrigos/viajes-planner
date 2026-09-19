import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { procesarTrabajo } from "@/lib/trabajador/procesarTrabajo";
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

// Doble del modelo (tal como pide el diseño para trabajador-ac2): encola
// respuestas de texto fijas y cuenta cuántas veces se invocó.
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

const DIAS_VALIDOS = JSON.stringify({ dias: planFixture.dias });

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("procesarTrabajo (trabajador-ac2)", () => {
  const supabase = clienteDePrueba();

  async function crearTrabajo() {
    const { data, error } = await supabase
      .from("trabajos")
      .insert({ tipo: "generacion", criterios: CRITERIOS })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);
    return data.id as string;
  }

  it("JSON truncado: dos intentos, 'fallido' con motivo, y cero planes guardados", async () => {
    const trabajoId = await crearTrabajo();
    const doble = dobleFijo(['{"dias": [']);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("fallido");
    expect(doble.invocaciones).toBe(2);
    const { data: trabajo } = await supabase.from("trabajos").select("estado, motivo, plan_id").eq("id", trabajoId).single();
    expect(trabajo?.estado).toBe("fallido");
    expect(trabajo?.motivo).toMatch(/JSON/i);
    // plan_id nulo es la prueba de que no se escribió nada a medias:
    // guardarPlan (y el UPDATE que enlaza plan_id) solo ocurren en la rama
    // de éxito, así que aquí ni siquiera hay un id que buscar en
    // plan_versiones.
    expect(trabajo?.plan_id).toBeNull();
  });

  it("parada fuera de franja: 'fallido' con motivo que nombra el campo", async () => {
    const trabajoId = await crearTrabajo();
    const diaConFranjaInvalida = structuredClone(planFixture.dias);
    diaConFranjaInvalida[0].paradas[0].franja_id = "no-existe";
    const doble = dobleFijo([JSON.stringify({ dias: diaConFranjaInvalida })]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("fallido");
    const { data: trabajo } = await supabase.from("trabajos").select("motivo, plan_id").eq("id", trabajoId).single();
    expect(trabajo?.motivo).toMatch(/franja_id/);
    expect(trabajo?.plan_id).toBeNull();
  });

  it("prioridad fuera de rango: 'fallido' con motivo que nombra el campo", async () => {
    const trabajoId = await crearTrabajo();
    const diaConPrioridadInvalida = structuredClone(planFixture.dias);
    diaConPrioridadInvalida[0].paradas[0].prioridad = 250;
    const doble = dobleFijo([JSON.stringify({ dias: diaConPrioridadInvalida })]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("fallido");
    const { data: trabajo } = await supabase.from("trabajos").select("motivo").eq("id", trabajoId).single();
    expect(trabajo?.motivo).toMatch(/prioridad/);
  });

  it("el reintento devuelve un plan válido: 'completado' y guardado", async () => {
    const trabajoId = await crearTrabajo();
    const doble = dobleFijo(['{"dias": [', DIAS_VALIDOS]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp" },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(2);
    const { data: trabajo } = await supabase.from("trabajos").select("estado, plan_id").eq("id", trabajoId).single();
    expect(trabajo?.estado).toBe("completado");
    expect(trabajo?.plan_id).toBeTruthy();
    const { count } = await supabase
      .from("plan_versiones")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", trabajo?.plan_id);
    expect(count).toBe(1);
  });
});
