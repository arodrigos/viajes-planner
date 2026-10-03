import { beforeEach, describe, expect, it } from "vitest";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { adquirirCerrojo, liberarCerrojo } from "@/lib/trabajador/cerrojo";
import { tick } from "@/lib/trabajador/tick";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { CandidatoLugar, FuenteLugares } from "@/lib/lugares/tipos";
import type { Dia, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESTINO = "Valencia-barrido-test";
const BBOX = { minLat: 39, maxLat: 40, minLon: -1, maxLon: 0 };

function candidato(nombre: string): CandidatoLugar {
  return {
    fuente: "osm",
    id: `osm:node/${nombre}`,
    url: `https://www.openstreetmap.org/node/${nombre}`,
    nombreFuente: nombre,
    nombresAlternativos: [],
    lat: 39.47,
    lon: -0.37,
    categoriaOsm: "historic",
    tipoOsm: "memorial",
    etiquetas: {},
  };
}

// Doble instrumentado: registra cada nombre por el que se preguntó a
// Nominatim, para comprobar tanto que las paradas de un plan eliminado
// nunca se consultan (rel-ac1) como que una parada ya resuelta no vuelve a
// pedirse en un barrido posterior (rel-ac1).
function fuenteInstrumentada(nominatim: Record<string, CandidatoLugar[]>): FuenteLugares & { consultadas: string[] } {
  const consultadas: string[] = [];
  return {
    consultadas,
    async geocodificarDestino() {
      return BBOX;
    },
    async buscarNominatim(nombre: string) {
      consultadas.push(nombre);
      return nominatim[nombre] ?? [];
    },
    async buscarWikipedia() {
      return [];
    },
  };
}

function ejecutorQueFalla(): EjecutorModelo {
  return {
    async invocar(): Promise<ResultadoInvocacion> {
      throw new Error("rel-ac1: el barrido no debe invocar nunca al modelo");
    },
  };
}

function diaConParadas(nombres: string[], fecha: string): Dia {
  return {
    fecha,
    franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
    paradas: nombres.map((nombre) => ({
      id: `${nombre}-id`,
      franja_id: "manana",
      nombre,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" },
      categoria: "monumento",
      // Sin coordenadas ni resolución: exactamente lo que deja un plan al
      // que todavía no le ha tocado el barrido (o cuyo intento caducó).
    })),
  };
}

async function sembrarPlan(
  supabase: ReturnType<typeof clienteDePrueba>,
  planId: string,
  nombres: string[],
  opciones: { eliminado?: boolean; fecha?: string } = {},
): Promise<void> {
  const plan: Plan = {
    id: planId,
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [diaConParadas(nombres, opciones.fecha ?? "2026-11-01")],
  };
  await guardarPlan(supabase, plan);
  const { error } = await supabase
    .from("trabajos")
    .insert({
      tipo: "generacion",
      criterios: { destino_o_tipo: DESTINO, fechas: { modo: "epoca", epoca: "otoño" }, dias: 1, personas: [{ edad: 30 }], perfil: "pareja", presupuesto_eur: 500 },
      estado: "completado",
      plan_id: planId,
      eliminado_en: opciones.eliminado ? new Date().toISOString() : null,
    });
  if (error) throw new Error(`No se pudo sembrar el trabajo de prueba: ${error.message}`);
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("barrido de relleno (rel-ac1, rel-ac2)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-barrido-%");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    // Estos tests exigen cola vacía para que el barrido sea lo único que
    // el tick hace; otros ficheros de integración (cola/crear, por
    // ejemplo) encolan trabajos reales sin plan de prueba y sin
    // limpiarlos después, porque esa no es su preocupación. Como todos
    // los ficheros de integración golpean la misma Postgres en serie
    // (fileParallelism: false), cerrar aquí cualquier trabajo que haya
    // quedado no terminal de un fichero anterior es seguro: sus propias
    // aserciones ya corrieron.
    await supabase.from("trabajos").update({ estado: "completado" }).in("estado", ["encolado", "en-curso", "pausado-por-cuota"]);
    // Vitest no garantiza orden alfabético entre ficheros con
    // fileParallelism:false (depende de su propio scheduler); varios
    // ficheros de trabajador (cuota, validacion, aislamiento-criterios)
    // ejecutan procesarTrabajo de verdad contra el doble del fixture de 5
    // días y dejan un plan real, con paradas sin resolver, enlazado por un
    // `trabajos.plan_id` -- exactamente lo que este barrido recoge como
    // "plan vivo". Esos ficheros ya completaron sus propias aserciones
    // cuando este se ejecuta (antes o después), así que barrer aquí
    // cualquier plan que no sea de este fichero es seguro y es lo único
    // que da un recuento determinista de "cuántas paradas pendientes hay".
    await supabase.from("planes").delete().not("id", "like", "plan-barrido-%");
  });

  it("con la cola vacía, resuelve las paradas pendientes de planes vivos, ignora las del plan eliminado, y no invoca al modelo", async () => {
    await sembrarPlan(supabase, "plan-barrido-vivo", ["Monumento Uno", "Monumento Dos", "Monumento Tres"]);
    await sembrarPlan(supabase, "plan-barrido-eliminado", ["Monumento Fantasma"], { eliminado: true });

    const nominatim: Record<string, CandidatoLugar[]> = {
      "Monumento Uno": [candidato("Monumento Uno")],
      "Monumento Dos": [candidato("Monumento Dos")],
      "Monumento Tres": [candidato("Monumento Tres")],
      "Monumento Fantasma": [candidato("Monumento Fantasma")],
    };
    const fuente = fuenteInstrumentada(nominatim);

    const resultado = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    expect(resultado.trabajosProcesados).toBe(0);
    expect(fuente.consultadas).toEqual(expect.arrayContaining(["Monumento Uno", "Monumento Dos", "Monumento Tres"]));
    expect(fuente.consultadas).not.toContain("Monumento Fantasma");

    const { data: paradasVivas } = await supabase
      .from("paradas")
      .select("nombre, lat, lon, resolucion, lugar")
      .in("nombre", ["Monumento Uno", "Monumento Dos", "Monumento Tres"]);
    expect(paradasVivas).toHaveLength(3);
    for (const parada of paradasVivas ?? []) {
      expect(parada.lat).toBeCloseTo(39.47);
      expect(parada.lon).toBeCloseTo(-0.37);
      expect((parada.resolucion as { estado: string }).estado).toBe("resuelta");
      expect((parada.lugar as { fuente: string }).fuente).toBe("osm");
    }

    const { data: paradaFantasma } = await supabase.from("paradas").select("lat, resolucion").eq("nombre", "Monumento Fantasma").single();
    expect(paradaFantasma?.lat).toBeNull();
    expect(paradaFantasma?.resolucion).toBeNull();
  });

  it("con 50 paradas pendientes, resuelve exactamente 40 en un tick y las 10 restantes en el siguiente, sin repetir ninguna", async () => {
    const nombres = Array.from({ length: 50 }, (_, i) => `Parada ${String(i).padStart(3, "0")}`);
    await sembrarPlan(supabase, "plan-barrido-cincuenta", nombres);

    const nominatim: Record<string, CandidatoLugar[]> = Object.fromEntries(
      nombres.map((nombre) => [nombre, [candidato(nombre)]]),
    );
    const fuente = fuenteInstrumentada(nominatim);

    const primerTick = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(primerTick.trabajosProcesados).toBe(0);
    expect(fuente.consultadas).toHaveLength(40);

    const { count: countResueltas } = await supabase
      .from("paradas")
      .select("id", { count: "exact", head: true })
      .not("resolucion", "is", null)
      .in("nombre", nombres);
    expect(countResueltas).toBe(40);

    const segundoTick = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(segundoTick.trabajosProcesados).toBe(0);
    expect(fuente.consultadas).toHaveLength(50);
    // Ninguna de las 50 se consultó dos veces: las 40 del primer tick no
    // vuelven a pedirse en el segundo.
    expect(new Set(fuente.consultadas).size).toBe(50);

    const { count: countResueltasFinal } = await supabase
      .from("paradas")
      .select("id", { count: "exact", head: true })
      .not("resolucion", "is", null)
      .in("nombre", nombres);
    expect(countResueltasFinal).toBe(50);
  });

  it("un fallo persistente en una parada concreta no tumba el tick ni deja el cerrojo cogido", async () => {
    await sembrarPlan(supabase, "plan-barrido-error", ["Parada Buena Uno", "Parada Rota", "Parada Buena Dos"]);

    const fuente: FuenteLugares = {
      async geocodificarDestino() {
        return BBOX;
      },
      async buscarNominatim(nombre: string) {
        if (nombre === "Parada Rota") throw new Error("429 persistente");
        return [candidato(nombre)];
      },
      async buscarWikipedia() {
        return [];
      },
    };

    const resultado = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    expect(resultado.cerrojoAdquirido).toBe(true);
    expect(resultado.trabajosProcesados).toBe(0);

    const { data: rota } = await supabase.from("paradas").select("resolucion").eq("nombre", "Parada Rota").single();
    expect((rota?.resolucion as { estado: string }).estado).toBe("error");

    const { data: buenas } = await supabase
      .from("paradas")
      .select("resolucion")
      .in("nombre", ["Parada Buena Uno", "Parada Buena Dos"]);
    for (const buena of buenas ?? []) {
      expect((buena.resolucion as { estado: string }).estado).toBe("resuelta");
    }

    // El cerrojo quedó liberado: un tick inmediato posterior puede volver a
    // adquirirlo.
    const liberado = await adquirirCerrojo(supabase, "comprobacion-cerrojo-libre");
    expect(liberado).toBe(true);
    await liberarCerrojo(supabase, "comprobacion-cerrojo-libre");
  });
});
