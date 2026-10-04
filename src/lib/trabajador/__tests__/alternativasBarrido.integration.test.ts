import { beforeEach, describe, expect, it } from "vitest";
import { tick } from "@/lib/trabajador/tick";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { EjecutorModelo, ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import type { CandidatoCercano, FuenteCercanos } from "@/lib/alternativas/cercanos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";
import type { Dia, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESTINO = "Sevilla-alt-barrido-test";
const BBOX = { minLat: 37, maxLat: 38, minLon: -6, maxLon: -5 };
const CIUDAD_RESUELTA: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: DESTINO, caja: BBOX, intentado_en: "2026-10-01T00:00:00Z" };

const FUENTE_FOTOS_SIN_RED = crearFuenteFotosGrabada({ paginas: {}, imagenes: {}, geosearch: {} });

// Las 4 paradas de este fichero ya están "resueltas" antes del tick: no
// debería hacer falta pedir nada a Nominatim. Si se le pregunta por algo,
// es que el barrido de ubicación está tocando lo que ya no le corresponde.
const FUENTE_LUGARES_SIN_RED: FuenteLugares & FuenteCiudad = {
  async geocodificarDestino() {
    return BBOX;
  },
  async buscarNominatim() {
    throw new Error("alt-ac1: las 4 paradas de este fichero ya están resueltas -- no debería consultarse Nominatim");
  },
  async buscarWikipedia() {
    return [];
  },
  async buscarLibre() {
    throw new Error("alt-ac1: la ciudad ya está resuelta -- no debería deducirse por paradas");
  },
  async geocodificarCiudad() {
    throw new Error("alt-ac1: la ciudad ya está resuelta -- no debería geocodificarse de nuevo");
  },
};

function ejecutorQueFalla(): EjecutorModelo {
  return {
    async invocar(): Promise<ResultadoInvocacion> {
      throw new Error("alt-ac1: el barrido no debe invocar nunca al modelo");
    },
  };
}

function cercano(nombre: string, lat: number, lon: number): CandidatoCercano {
  return { id: `osm:node/${nombre}`, nombre, lat, lon };
}

// Doble instrumentado: cuenta cada consulta a Overpass y responde según la
// categoría+coordenadas de la parada que preguntó, para comprobar tanto los
// 3 guardados de cp-alt-01 como que un segundo tick no vuelve a consultar.
function fuenteCercanosContada(): FuenteCercanos & { consultas: number } {
  let consultas = 0;
  return {
    get consultas() {
      return consultas;
    },
    async buscar(_categoria, lat) {
      consultas++;
      if (Math.abs(lat - 37.1) < 0.01) {
        return [1, 2, 3, 4, 5].map((n) => cercano(`Cercano A${n}`, 37.101 + n * 0.001, -5.901));
      }
      if (Math.abs(lat - 37.2) < 0.01) {
        return [];
      }
      // lat ~37.3: la parada cuya consulta a Overpass falla.
      throw new Error("429 persistente");
    },
  };
}

function diaConParadas(nombres: string[]): Dia {
  return {
    fecha: "2026-11-01",
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
    })),
  };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("tercer barrido de alternativas (alt-ac1)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-alt-barrido-%");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    await supabase.from("trabajos").update({ estado: "completado" }).in("estado", ["encolado", "en-curso", "pausado-por-cuota"]);
    // Mismo motivo que en barrido.integration.test.ts: varios ficheros de
    // trabajador dejan planes reales sin limpiar y este barrido los
    // recoge a todos; barrer lo ajeno a este fichero da un recuento
    // determinista de consultas a Overpass.
    await supabase.from("planes").delete().not("id", "like", "plan-alt-barrido-%");
  });

  it("cp-alt-01: guarda hasta 3 cercanos por parada, marca siempre el intento y no repite Overpass en un segundo tick", async () => {
    const nombres = ["Parada Con Cercanos", "Parada Sin Cercanos Ajenos", "Parada Sin Categoria", "Parada Overpass Falla"];
    const plan: Plan = {
      id: "plan-alt-barrido-sevilla",
      version: 1,
      destino: DESTINO,
      personas: 2,
      dias: [diaConParadas(nombres)],
      ciudad: CIUDAD_RESUELTA,
    };
    await guardarPlan(supabase, plan);

    const { data: filas } = await supabase.from("paradas").select("id, nombre").in("nombre", nombres);
    const idPorNombre = new Map((filas ?? []).map((f) => [f.nombre as string, f.id as string]));

    const resuelta = (intentadoEn: string) => ({ estado: "resuelta", intentado_en: intentadoEn });
    await supabase
      .from("paradas")
      .update({ lat: 37.1, lon: -5.9, categoria: "monumento", resolucion: resuelta("2026-10-01T00:00:00Z") })
      .eq("id", idPorNombre.get("Parada Con Cercanos"));
    await supabase
      .from("paradas")
      .update({ lat: 37.2, lon: -5.9, categoria: "monumento", resolucion: resuelta("2026-10-01T00:00:00Z") })
      .eq("id", idPorNombre.get("Parada Sin Cercanos Ajenos"));
    await supabase
      .from("paradas")
      .update({ lat: 37.15, lon: -5.9, categoria: null, resolucion: resuelta("2026-10-01T00:00:00Z") })
      .eq("id", idPorNombre.get("Parada Sin Categoria"));
    await supabase
      .from("paradas")
      .update({ lat: 37.3, lon: -5.9, categoria: "monumento", resolucion: resuelta("2026-10-01T00:00:00Z") })
      .eq("id", idPorNombre.get("Parada Overpass Falla"));

    const fuenteCercanos = fuenteCercanosContada();
    await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: FUENTE_LUGARES_SIN_RED,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    const { data: todas } = await supabase.from("paradas").select("id, nombre, alternativas_intentadas_en").in("nombre", nombres);
    for (const fila of todas ?? []) {
      expect(fila.alternativas_intentadas_en).not.toBeNull();
    }

    const idConCercanos = idPorNombre.get("Parada Con Cercanos");
    const { data: alternativasConCercanos } = await supabase.from("paradas_alternativas").select("*").eq("parada_id", idConCercanos);
    expect(alternativasConCercanos).toHaveLength(3);
    for (const alternativa of alternativasConCercanos ?? []) {
      expect(alternativa.origen).toBe("cercano");
      expect(alternativa.motivo).toMatch(/A \d+ m/);
      expect(alternativa.duracion_min).toBe(60);
      expect(alternativa.lat).not.toBeNull();
      expect(alternativa.lon).not.toBeNull();
      expect((alternativa.lugar as { url: string }).url.startsWith("https://www.openstreetmap.org/")).toBe(true);
    }

    const idSinCercanos = idPorNombre.get("Parada Sin Cercanos Ajenos");
    const { data: alternativasSinCercanos } = await supabase.from("paradas_alternativas").select("*").eq("parada_id", idSinCercanos);
    expect(alternativasSinCercanos).toHaveLength(0);

    const idSinCategoria = idPorNombre.get("Parada Sin Categoria");
    const { data: alternativasSinCategoria } = await supabase.from("paradas_alternativas").select("*").eq("parada_id", idSinCategoria);
    expect(alternativasSinCategoria).toHaveLength(0);

    const idOverpassFalla = idPorNombre.get("Parada Overpass Falla");
    const { data: alternativasOverpassFalla } = await supabase.from("paradas_alternativas").select("*").eq("parada_id", idOverpassFalla);
    expect(alternativasOverpassFalla).toHaveLength(0);

    // Solo 3 consultas: "Parada Sin Categoria" nunca llega a preguntar.
    expect(fuenteCercanos.consultas).toBe(3);

    const segundaFuente = fuenteCercanosContada();
    await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: FUENTE_LUGARES_SIN_RED,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos: segundaFuente,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });
    expect(segundaFuente.consultas).toBe(0);

    const { data: alternativasTrasSegundoTick } = await supabase.from("paradas_alternativas").select("*").eq("parada_id", idConCercanos);
    expect(alternativasTrasSegundoTick).toHaveLength(3);
  });
});
