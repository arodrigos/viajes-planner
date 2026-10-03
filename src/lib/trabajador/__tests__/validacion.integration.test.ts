import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { procesarTrabajo } from "@/lib/trabajador/procesarTrabajo";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { crearFuenteLugaresGrabada } from "@/lib/lugares/fuenteGrabada";
import { RESPUESTA_MODELO_FORMA_NUEVA } from "./__fixtures__/respuesta-modelo-forma-nueva";

// lug-ac3: este test no es de lugares-resolucion -- sin fixtures no hay
// ningún candidato que aceptar, así que resolverPlan deja todo
// "no-resuelta" sin disparar una sola petición real a Nominatim/Wikipedia.
const FUENTE_LUGARES_SIN_RED = crearFuenteLugaresGrabada({ destinos: {}, nominatim: {} });

// Los criterios reales con los que se capturó RESPUESTA_MODELO_FORMA_NUEVA
// -- necesarios para que franjasComoArray(destino) calce con los franja_id
// que trae la respuesta real.
const CRITERIOS_DE_LA_CAPTURA: CriteriosViaje = {
  destino_o_tipo: "Roma",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 3,
  personas: [{ edad: 38 }, { edad: 36 }],
  perfil: "pareja",
  presupuesto_eur: 900,
};

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

  async function crearTrabajo(criterios: CriteriosViaje = CRITERIOS) {
    const { data, error } = await supabase
      .from("trabajos")
      .insert({ tipo: "generacion", criterios })
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
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
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
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
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
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("fallido");
    const { data: trabajo } = await supabase.from("trabajos").select("motivo").eq("id", trabajoId).single();
    expect(trabajo?.motivo).toMatch(/prioridad/);
  });

  it("respuesta real (forma nueva, sin valla): el trabajo llega a 'completado' de verdad", async () => {
    // Captura literal de una invocación real de claude -p (2026-09-21) tras
    // el fix de campos: el prompt ya pide fecha+paradas planas con
    // nombre/descripcion/duracion_min/prioridad/franja_id, y deja que el
    // sistema rellene id/franjas/procedencia. Esta es la prueba real de que
    // el producto genera un viaje, no solo de que un test pasa.
    const trabajoId = await crearTrabajo(CRITERIOS_DE_LA_CAPTURA);
    const doble = dobleFijo([RESPUESTA_MODELO_FORMA_NUEVA]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS_DE_LA_CAPTURA },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(1);
    const { data: trabajo } = await supabase.from("trabajos").select("estado, motivo, plan_id").eq("id", trabajoId).single();
    expect(trabajo?.estado).toBe("completado");
    expect(trabajo?.plan_id).toBeTruthy();
    const { count } = await supabase
      .from("plan_versiones")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", trabajo?.plan_id);
    expect(count).toBe(1);
  });

  it("un día sin ninguna parada: 'fallido' en vez de 'completado' vacío", async () => {
    // Hallazgo real (2026-09-21): al dejar que el sistema rellene
    // id/franjas/procedencia (ensamblarDia en procesarTrabajo.ts), un día
    // sin ninguna parada del modelo colaba un "completado" vacío -- la
    // clave "paradas" siempre se emite (aunque sea []), y el esquema no
    // exigía ningún mínimo. Un viaje sin una sola parada no es un viaje.
    const trabajoId = await crearTrabajo(CRITERIOS_DE_LA_CAPTURA);
    const sinParadas = JSON.stringify({
      dias: [{ fecha: "2027-04-15" }, { fecha: "2027-04-16" }, { fecha: "2027-04-17" }],
    });
    const doble = dobleFijo([sinParadas, sinParadas]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS_DE_LA_CAPTURA },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("fallido");
    const { data: trabajo } = await supabase.from("trabajos").select("motivo, plan_id").eq("id", trabajoId).single();
    expect(trabajo?.motivo).toMatch(/paradas/);
    expect(trabajo?.plan_id).toBeNull();
  });

  it("la misma respuesta real, envuelta en valla a mano: sigue completando (defensa en profundidad)", async () => {
    // No es una segunda captura real -- es la MISMA respuesta real de
    // arriba, envuelta en la valla que el modelo sí usó la primera vez que
    // se probó este código (issue trabajador, 2026-09-21). Prueba las dos
    // defensas juntas (extraerJson + el mapeo de campos nuevo) sin gastar
    // una tercera invocación real. Falla con el código de antes del fix
    // del fence (motivo "(raíz)...") y con el código de antes del fix de
    // campos (motivo con "must have required property").
    const trabajoId = await crearTrabajo(CRITERIOS_DE_LA_CAPTURA);
    const conValla = "```json\n" + RESPUESTA_MODELO_FORMA_NUEVA + "\n```";
    const doble = dobleFijo([conValla]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS_DE_LA_CAPTURA },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(1);
  });

  it("el reintento devuelve un plan válido: 'completado' y guardado", async () => {
    const trabajoId = await crearTrabajo();
    const doble = dobleFijo(['{"dias": [', DIAS_VALIDOS]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
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

  it("reco-ac6: una recomendación válida no cuesta una invocación de más", async () => {
    const trabajoId = await crearTrabajo();
    const conRecomendaciones = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [{ tipo: "comida", nombre: "Bar de la Alameda", motivo: "Tapas locales, poco turístico." }],
    });
    const doble = dobleFijo([conRecomendaciones]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(1);
    const { data: trabajo } = await supabase.from("trabajos").select("plan_id").eq("id", trabajoId).single();
    const { data: version } = await supabase
      .from("plan_versiones")
      .select("recomendaciones")
      .eq("plan_id", trabajo?.plan_id)
      .single();
    expect(version?.recomendaciones).toEqual([
      { tipo: "comida", nombre: "Bar de la Alameda", motivo: "Tapas locales, poco turístico." },
    ]);
  });

  it("reco-ac6: una recomendación con tipo inválido sigue costando solo el reintento que ya existía", async () => {
    const trabajoId = await crearTrabajo();
    const tipoInvalido = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [{ tipo: "hotel", nombre: "Sitio cualquiera", motivo: "Motivo cualquiera." }],
    });
    const doble = dobleFijo([tipoInvalido, DIAS_VALIDOS]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(2);
  });

  it("reco-ac7(a): sin recomendaciones, el trabajo llega igual a 'completado' y el plan se guarda", async () => {
    const trabajoId = await crearTrabajo();
    const doble = dobleFijo([DIAS_VALIDOS]);

    const resultado = await procesarTrabajo(
      supabase,
      { id: trabajoId, plan_id: null, criterios: CRITERIOS },
      { ejecutor: doble, directorio: "/tmp", fuenteLugares: FUENTE_LUGARES_SIN_RED },
    );

    expect(resultado.estado).toBe("completado");
    expect(doble.invocaciones).toBe(1);
    const { data: trabajo } = await supabase.from("trabajos").select("plan_id").eq("id", trabajoId).single();
    expect(trabajo?.plan_id).toBeTruthy();
    const { data: version } = await supabase
      .from("plan_versiones")
      .select("recomendaciones")
      .eq("plan_id", trabajo?.plan_id)
      .single();
    expect(version?.recomendaciones).toEqual([]);
  });
});
