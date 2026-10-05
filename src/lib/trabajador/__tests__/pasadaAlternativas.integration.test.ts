import { beforeEach, describe, expect, it } from "vitest";
import { completarParadasPendientes } from "@/lib/trabajador/barrido";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { CandidatoCercano, FuenteCercanos } from "@/lib/alternativas/cercanos";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";
import type { Foto, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESTINO = "Londres-alc-pasada-test";
const BBOX = { minLat: 51, maxLat: 52, minLon: -1, maxLon: 0 };
const CIUDAD_RESUELTA: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: DESTINO, caja: BBOX, intentado_en: "2026-10-01T00:00:00Z" };

// El corte va inyectado: el test no depende del reloj real.
const CORTE = new Date("2026-10-06T00:00:00Z");
const ANTES_DEL_CORTE = "2026-10-04T00:00:00Z";
const DESPUES_DEL_CORTE = "2026-10-07T00:00:00Z";

const FOTO: Foto = {
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Museo-B.jpg/640px-Museo-B.jpg",
  fichero: "Museo-B.jpg",
  autor: "Autora",
  licencia: "CC BY-SA 4.0",
  licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
  pagina_url: "https://commons.wikimedia.org/wiki/File:Museo-B.jpg",
  fuente: "commons",
};
const FUENTE_FOTOS = crearFuenteFotosGrabada({
  paginas: { "es:Museo Vecino": { fichero: "Museo-B.jpg" } },
  imagenes: { "Museo-B.jpg": FOTO },
});

// Todas las paradas del fichero ya están resueltas y la ciudad también: si
// el barrido pregunta por algo, está tocando lo que no le corresponde.
const FUENTE_LUGARES_SIN_RED: FuenteLugares & FuenteCiudad = {
  async geocodificarDestino() {
    return BBOX;
  },
  async buscarNominatim() {
    throw new Error("alc-ac2: las paradas ya están resueltas -- no debería consultarse Nominatim");
  },
  async buscarWikipedia() {
    return [];
  },
  async buscarLibre() {
    throw new Error("alc-ac2: la ciudad ya está resuelta");
  },
  async geocodificarCiudad() {
    throw new Error("alc-ac2: la ciudad ya está resuelta");
  },
};

function museo(nombre: string, lat: number): CandidatoCercano {
  return { id: `osm:node/${nombre}`, nombre, lat, lon: -0.5 };
}

function fuenteCercanosContada(): FuenteCercanos & { consultas: number } {
  let consultas = 0;
  return {
    get consultas() {
      return consultas;
    },
    async buscar(_categoria, lat) {
      consultas++;
      // Solo responde para la parada de «Natural History Museum» (lat 51.1).
      return Math.abs(lat - 51.1) < 0.01 ? [1, 2, 3].map((n) => museo(`Museo cercano ${n}`, 51.1 + n * 0.002)) : [];
    },
  };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("pasada única de alternativas (alc-ac2)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-alc-pasada-%");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    // Mismo motivo que alternativasBarrido.integration.test.ts: el barrido
    // recoge todos los planes de la base, y lo ajeno falsea el recuento.
    await supabase.from("planes").delete().not("id", "like", "plan-alc-pasada-%");
  });

  it("cp-alc-02: reintenta una vez las paradas con 0 alternativas intentadas antes del corte, busca foto de las guardadas y no repite", async () => {
    const nombres = ["Natural History Museum", "Parada Con Alternativa Sin Foto", "Parada Intentada Despues Del Corte"];
    const plan: Plan = {
      id: "plan-alc-pasada-londres",
      version: 1,
      destino: DESTINO,
      personas: 2,
      ciudad: CIUDAD_RESUELTA,
      dias: [
        {
          fecha: "2026-11-01",
          franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
          paradas: nombres.map((nombre) => ({
            id: `${nombre}-id`,
            franja_id: "manana",
            nombre,
            descripcion: "",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" as const },
            categoria: "museo" as const,
          })),
        },
      ],
    };
    await guardarPlan(supabase, plan);

    const { data: filas } = await supabase.from("paradas").select("id, nombre").in("nombre", nombres);
    const idPorNombre = new Map((filas ?? []).map((f) => [f.nombre as string, f.id as string]));
    const resuelta = { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" };
    const ubicar = (nombre: string, lat: number, intentada: string) =>
      supabase
        .from("paradas")
        .update({ lat, lon: -0.5, resolucion: resuelta, alternativas_intentadas_en: intentada })
        .eq("id", idPorNombre.get(nombre));
    await ubicar("Natural History Museum", 51.1, ANTES_DEL_CORTE);
    await ubicar("Parada Con Alternativa Sin Foto", 51.3, ANTES_DEL_CORTE);
    await ubicar("Parada Intentada Despues Del Corte", 51.1, DESPUES_DEL_CORTE);

    const { error: errorAlternativa } = await supabase.from("paradas_alternativas").insert({
      parada_id: idPorNombre.get("Parada Con Alternativa Sin Foto"),
      origen: "cercano",
      nombre: "Museo Vecino",
      descripcion: "d",
      motivo: "A 200 m, misma categoría según OpenStreetMap.",
      duracion_min: 60,
      categoria: "museo",
      lat: 51.301,
      lon: -0.5,
      lugar: { fuente: "wikipedia", id: "wikipedia:es:Museo Vecino", url: "https://es.wikipedia.org/wiki/Museo_Vecino", nombre_fuente: "Museo Vecino", etiquetas: {}, resuelto_en: ANTES_DEL_CORTE },
    });
    expect(errorAlternativa).toBeNull();

    const fuenteCercanos = fuenteCercanosContada();
    await completarParadasPendientes(supabase, FUENTE_LUGARES_SIN_RED, 120, FUENTE_FOTOS, undefined, undefined, fuenteCercanos, CORTE);

    const { data: alternativasMuseo } = await supabase
      .from("paradas_alternativas")
      .select("origen")
      .eq("parada_id", idPorNombre.get("Natural History Museum"));
    expect(alternativasMuseo?.length).toBeGreaterThanOrEqual(1);
    expect(alternativasMuseo?.length).toBeLessThanOrEqual(3);

    const { data: conFoto } = await supabase
      .from("paradas_alternativas")
      .select("foto")
      .eq("parada_id", idPorNombre.get("Parada Con Alternativa Sin Foto"))
      .single();
    expect((conFoto?.foto as Foto | null)?.fichero).toBe("Museo-B.jpg");

    const { data: paradas } = await supabase.from("paradas").select("nombre, alternativas_intentadas_en").in("nombre", nombres);
    for (const fila of paradas ?? []) {
      expect(new Date(fila.alternativas_intentadas_en as string).getTime()).toBeGreaterThanOrEqual(CORTE.getTime());
    }
    // La intentada después del corte no se toca: conserva su fecha y no consulta.
    const despuesDelCorte = (paradas ?? []).find((f) => f.nombre === "Parada Intentada Despues Del Corte");
    expect(new Date(despuesDelCorte?.alternativas_intentadas_en as string).toISOString()).toBe(new Date(DESPUES_DEL_CORTE).toISOString());
    expect(fuenteCercanos.consultas).toBe(1);

    // Segunda pasada: 0 peticiones a Overpass y sin alternativas nuevas.
    const segunda = fuenteCercanosContada();
    await completarParadasPendientes(supabase, FUENTE_LUGARES_SIN_RED, 120, FUENTE_FOTOS, undefined, undefined, segunda, CORTE);
    expect(segunda.consultas).toBe(0);
    const { data: trasSegunda } = await supabase
      .from("paradas_alternativas")
      .select("id")
      .eq("parada_id", idPorNombre.get("Natural History Museum"));
    expect(trasSegunda?.length).toBe(alternativasMuseo?.length);
  });
});
