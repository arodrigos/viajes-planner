import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { Plan } from "@/lib/plan/tipos";
import { casarLugaresPendientes, type Peticion } from "../casar";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CLAVE_FICTICIA = "clave-ficticia-casar-test";
const CIUDAD: CiudadEfectiva = {
  estado: "resuelta",
  metodo: "destino",
  nombre: "Londres",
  caja: { minLat: 51, maxLat: 52, minLon: -1, maxLon: 0 },
  intentado_en: "2026-10-01T00:00:00Z",
};

const grabada = (nombre: string) => readFileSync(`fixtures/google/${nombre}.json`, "utf8");

// El doble de Google: responde por el texto de la consulta con respuestas
// grabadas y apunta cada petición para poder contarlas.
function dobleGoogle() {
  const llamadas: Array<{ url: string; cabeceras: Record<string, string>; cuerpo: { textQuery: string; locationRestriction: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } } } }> = [];
  const peticion: Peticion = async (url, init) => {
    const cuerpo = JSON.parse(init.body as string);
    llamadas.push({ url, cabeceras: init.headers as Record<string, string>, cuerpo });
    const texto: string = cuerpo.textQuery;
    const respuesta = texto.startsWith("British Museum")
      ? grabada("textsearch-british-museum")
      : texto.startsWith("Borough Market")
        ? grabada("textsearch-borough-market")
        : grabada("textsearch-tower-lejos");
    return new Response(respuesta, { status: 200 });
  };
  return { peticion, llamadas };
}

function diaConParadas(nombres: string[]) {
  return {
    fecha: "2026-12-10",
    ancla_alojamiento: undefined,
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
  };
}

const lugarDe = (fuente: "osm" | "wikipedia", id: string) => ({ fuente, id, url: "https://example.org", nombre_fuente: "x", etiquetas: {}, resuelto_en: "2026-10-01T00:00:00Z" });

function hoyEnElPacifico(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("casado de place_id (cas-ac1, cas-ac4)", () => {
  const supabase = clienteDePrueba();

  async function sembrar() {
    const nombres = ["British Museum", "Borough Market", "Tower of London", "Cena en Dishoom"];
    const plan: Plan = { id: "plan-casar-londres", version: 1, destino: "Londres", personas: 2, dias: [diaConParadas(nombres)], ciudad: CIUDAD };
    await guardarPlan(supabase, plan);
    const { data } = await supabase.from("paradas").select("id, nombre").in("nombre", nombres);
    const id = new Map((data ?? []).map((f) => [f.nombre as string, f.id as string]));
    const actualizar = (nombre: string, lat: number, lon: number, lugar: unknown) =>
      supabase.from("paradas").update({ lat, lon, lugar }).eq("id", id.get(nombre));
    await actualizar("British Museum", 51.5194, -0.127, lugarDe("osm", "osm:node/casar-1"));
    await actualizar("Borough Market", 51.5055, -0.091, lugarDe("osm", "osm:node/casar-2"));
    await actualizar("Tower of London", 51.5081, -0.0759, lugarDe("wikipedia", "wikipedia:es:Torre de Londres casar"));
    // Sin lugar verificado: no debe generar jamás una petición.
    await supabase.from("paradas").update({ lat: 51.51, lon: -0.13 }).eq("id", id.get("Cena en Dishoom"));
    return id;
  }

  async function consumoTextSearch(): Promise<number> {
    const { data } = await supabase.from("consumo_google").select("usados").eq("sku", "text_search_pro").eq("dia", hoyEnElPacifico()).maybeSingle();
    return (data?.usados as number | undefined) ?? 0;
  }

  beforeEach(async () => {
    await supabase.from("planes").delete().not("id", "like", "plan-casar-%");
    await supabase.from("planes").delete().like("id", "plan-casar-%");
    await supabase.from("lugares_google").delete().like("clave", "%casar%");
    await supabase.from("consumo_google").delete().eq("dia", hoyEnElPacifico());
  });

  it("casar-tick: casa las cercanas, marca sin-coincidencia la lejana, ignora la no comprobada y no repite", async () => {
    await sembrar();
    const doble = dobleGoogle();
    const antes = await consumoTextSearch();

    const primero = await casarLugaresPendientes(supabase, { clave: CLAVE_FICTICIA, peticion: doble.peticion });
    expect(doble.llamadas).toHaveLength(3);
    for (const llamada of doble.llamadas) {
      expect(llamada.url).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(llamada.url).not.toContain("key=");
      expect(llamada.cabeceras["X-Goog-FieldMask"]).toBe("places.id,places.location");
      expect(llamada.cabeceras["X-Goog-Api-Key"]).toBe(CLAVE_FICTICIA);
      const { low, high } = llamada.cuerpo.locationRestriction.rectangle;
      expect(low.latitude).toBeLessThan(high.latitude);
    }
    expect(doble.llamadas.map((l) => l.cuerpo.textQuery).some((t) => t.startsWith("Cena en Dishoom"))).toBe(false);
    expect(primero).toMatchObject({ casadas: 2, sinCoincidencia: 1, errores: 0, peticiones: 3 });

    const { data: filas } = await supabase.from("lugares_google").select("*").like("clave", "%casar%");
    expect(filas).toHaveLength(3);
    for (const fila of filas ?? []) expect(Object.keys(fila).sort()).toEqual(["clave", "comprobado_en", "estado", "place_id"]);
    const casadas = (filas ?? []).filter((f) => f.estado === "casado");
    expect(casadas).toHaveLength(2);
    expect(casadas.every((f) => typeof f.place_id === "string")).toBe(true);
    const sinCoincidencia = (filas ?? []).filter((f) => f.estado === "sin-coincidencia");
    expect(sinCoincidencia).toHaveLength(1);
    expect(sinCoincidencia[0].place_id).toBeNull();
    expect((await consumoTextSearch()) - antes).toBe(3);

    const segundo = dobleGoogle();
    await casarLugaresPendientes(supabase, { clave: CLAVE_FICTICIA, peticion: segundo.peticion });
    expect(segundo.llamadas).toHaveLength(0);
  });

  it("sin GOOGLE_PLACES_CLAVE: 0 peticiones, 0 filas y no falla", async () => {
    await sembrar();
    const doble = dobleGoogle();
    const resultado = await casarLugaresPendientes(supabase, { clave: undefined, peticion: doble.peticion });
    expect(resultado.clavePresente).toBe(false);
    expect(doble.llamadas).toHaveLength(0);
    const { data } = await supabase.from("lugares_google").select("clave").like("clave", "%casar%");
    expect(data).toHaveLength(0);
  });

  it("con el tope del día agotado tras la 2.ª, solo salen 2 peticiones y la 3.ª sigue pendiente", async () => {
    await sembrar();
    const { data: tope } = await supabase.from("topes_google").select("tope_dia").eq("sku", "text_search_pro").single();
    await supabase.from("consumo_google").upsert({ sku: "text_search_pro", dia: hoyEnElPacifico(), usados: (tope?.tope_dia as number) - 2 });
    const doble = dobleGoogle();
    const resultado = await casarLugaresPendientes(supabase, { clave: CLAVE_FICTICIA, peticion: doble.peticion });
    expect(doble.llamadas).toHaveLength(2);
    expect(resultado.topeAgotado).toBe(true);
    const { data } = await supabase.from("lugares_google").select("clave").like("clave", "%casar%");
    expect(data).toHaveLength(2);
  });

  it("cas-ac4: una versión nueva no repite lugares casados y la parada sustituida se casa en el tick siguiente", async () => {
    await sembrar();
    const primero = dobleGoogle();
    await casarLugaresPendientes(supabase, { clave: CLAVE_FICTICIA, peticion: primero.peticion });

    // Versión 2 del plan: las mismas paradas más un lugar nuevo en lugar de la Torre.
    const nombres = ["British Museum", "Borough Market", "Tower of London", "Cena en Dishoom"];
    const { version } = await guardarPlan(supabase, { id: "plan-casar-londres", version: 2, destino: "Londres", personas: 2, dias: [diaConParadas(nombres)], ciudad: CIUDAD });
    const { data: versiones } = await supabase.from("plan_versiones").select("id").eq("plan_id", "plan-casar-londres").eq("version", version).single();
    const { data: paradasV2 } = await supabase.from("paradas").select("id, nombre").eq("plan_version_id", versiones?.id);
    const idV2 = new Map((paradasV2 ?? []).map((f) => [f.nombre as string, f.id as string]));
    await supabase.from("paradas").update({ lat: 51.5194, lon: -0.127, lugar: lugarDe("osm", "osm:node/casar-1") }).eq("id", idV2.get("British Museum"));
    await supabase.from("paradas").update({ lat: 51.5055, lon: -0.091, lugar: lugarDe("osm", "osm:node/casar-2") }).eq("id", idV2.get("Borough Market"));
    await supabase.from("paradas").update({ lat: 51.5081, lon: -0.0759, lugar: lugarDe("osm", "osm:node/casar-3") }).eq("id", idV2.get("Tower of London"));

    const segundo = dobleGoogle();
    await casarLugaresPendientes(supabase, { clave: CLAVE_FICTICIA, peticion: segundo.peticion });
    // Solo el lugar nuevo: los dos casados y el sin-coincidencia reciente no se repiten.
    expect(segundo.llamadas).toHaveLength(1);
    expect(segundo.llamadas[0].cuerpo.textQuery.startsWith("Tower of London")).toBe(true);
  });
});
