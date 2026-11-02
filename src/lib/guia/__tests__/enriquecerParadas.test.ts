import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { Reloj } from "@/lib/lugares/limitador";
import type { FuenteFotos } from "@/lib/lugares/tipos";
import type { EtapaPlan, Lugar } from "@/lib/plan/tipos";
import { ciudadDeParada, enriquecerGuiaDePlan, enriquecerGuiaPendientes, enriquecerParadas, FORMATO_GUIA, type DependenciasGuia } from "../enriquecer";
import { EsperaExcedida, FalloFuenteGuia, type FuenteGuia, type PaginaGuia } from "../wikivoyage";
import type { FichaGuia } from "../wikitexto";

// Pruebas sin base de datos: el cliente falso solo anota lo que se escribiría
// con `update(...).eq("id", ...)`, que es todo lo que enriquecerParadas usa.
// El recorrido completo contra Supabase vive en enriquecer.integration.test.ts.

const EXTRACTO = (JSON.parse(readFileSync(join(process.cwd(), "fixtures/guia/es-wikipedia-real-alcazar.json"), "utf8")) as { extract: string }).extract;
const reloj: Reloj = { ahora: () => Date.parse("2026-10-05T12:00:00Z"), dormir: async () => undefined };

const resuelta = (nombre: string): CiudadEfectiva => ({ estado: "resuelta", metodo: "destino", nombre, caja: { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 }, intentado_en: "2026-10-01T00:00:00Z" });

interface Escritura {
  tabla: string;
  id: unknown;
  datos: Record<string, unknown>;
}

function supabaseFalso(error: { message: string } | null = null) {
  const escrituras: Escritura[] = [];
  const cliente = {
    from: (tabla: string) => ({
      update: (datos: Record<string, unknown>) => ({
        eq: async (_columna: string, id: unknown) => {
          escrituras.push({ tabla, id, datos });
          return { error };
        },
      }),
    }),
  };
  return { cliente: cliente as unknown as SupabaseClient, escrituras };
}

function fuenteGuiaFalsa(paginas: Record<string, PaginaGuia | null | Error>) {
  const pedidas: Array<{ ciudad: string; hasta?: number }> = [];
  const fuente: FuenteGuia = {
    async paginaCiudad(ciudad, hasta) {
      pedidas.push({ ciudad, hasta });
      const p = paginas[ciudad];
      if (p instanceof Error) throw p;
      return p ?? null;
    },
  };
  return { fuente, pedidas };
}

const sinFotos = crearFuenteFotosGrabada({ paginas: {}, imagenes: {} });

function deps(fuenteGuia: FuenteGuia, extra: Partial<DependenciasGuia> = {}): DependenciasGuia {
  return { fuenteGuia, fuenteFotos: sinFotos, reloj, ...extra };
}

const ficha = (nombre: string, extra: Partial<FichaGuia> = {}): FichaGuia => ({ tipo: "see", nombre, contenido: `Consejo de ${nombre}.`, ...extra });
const pagina = (fichas: FichaGuia[]): PaginaGuia => ({ idioma: "es", titulo: "Sevilla", url: "https://es.wikivoyage.org/wiki/Sevilla", fichas });

type FilaEntrada = Parameters<typeof enriquecerParadas>[2][number];
function fila(id: string, nombre: string, extra: Partial<FilaEntrada> = {}): FilaEntrada {
  return { id, nombre, lat: null, lon: null, lugar: null, coste: null, dia_index: 0, plan_version_id: "v1", ciudad: "Sevilla", ...extra };
}

describe("ciudadDeParada", () => {
  const etapas = [
    { ciudad: resuelta("Lisboa"), dia_inicio: 0, dias: 3 },
    { ciudad: { estado: "sin-ciudad-identificable", nombre: "Pueblo", intentado_en: "x" }, dia_inicio: 3, dias: 2 },
    { ciudad: resuelta("Oporto"), dia_inicio: 5, dias: 3 },
  ] as unknown as EtapaPlan[];

  it("en un viaje de varias ciudades usa la ciudad de la etapa del día", () => {
    const version = { id: "v", ciudad: resuelta("Portugal"), etapas };
    expect(ciudadDeParada(version, 0)).toBe("Lisboa");
    expect(ciudadDeParada(version, 2)).toBe("Lisboa");
    expect(ciudadDeParada(version, 5)).toBe("Oporto");
    expect(ciudadDeParada(version, 7)).toBe("Oporto");
  });

  it("una etapa sin ciudad resuelta no pide guía, aunque el plan tenga ciudad", () => {
    expect(ciudadDeParada({ id: "v", ciudad: resuelta("Portugal"), etapas }, 3)).toBeNull();
  });

  it("un día fuera de todas las etapas cae en la ciudad del plan", () => {
    expect(ciudadDeParada({ id: "v", ciudad: resuelta("Portugal"), etapas }, 8)).toBe("Portugal");
  });

  it("en un viaje de una ciudad usa la efectiva del plan, solo si está resuelta y con nombre", () => {
    expect(ciudadDeParada({ id: "v", ciudad: resuelta("Sevilla") }, 4)).toBe("Sevilla");
    expect(ciudadDeParada({ id: "v", ciudad: resuelta("Sevilla"), etapas: null }, 4)).toBe("Sevilla");
    expect(ciudadDeParada({ id: "v", ciudad: null }, 0)).toBeNull();
    expect(ciudadDeParada({ id: "v", ciudad: { ...resuelta(""), nombre: "" } as CiudadEfectiva }, 0)).toBeNull();
  });
});

describe("enriquecerParadas", () => {
  it("asigna la ficha por nombre, convierte su precio en coste y marca el formato actual", async () => {
    const { fuente } = fuenteGuiaFalsa({ Sevilla: pagina([ficha("Real Alcázar", { precio_texto: "10 €", precio_eur: 10 })]) });
    const { cliente, escrituras } = supabaseFalso();

    const r = await enriquecerParadas(cliente, deps(fuente), [fila("p1", "Real Alcázar"), fila("p2", "Bar sin ficha")]);

    expect(r).toEqual({ intentadas: 2, con_guia: 1, con_curiosidades: 0, pospuestas: 0 });
    expect(escrituras.map((e) => [e.tabla, e.id])).toEqual([
      ["paradas", "p1"],
      ["paradas", "p2"],
    ]);
    expect(escrituras[0].datos).toEqual({
      guia: { consejo: "Consejo de Real Alcázar.", precio_texto: "10 €", precio_eur: 10, url: "https://es.wikivoyage.org/wiki/Sevilla", licencia: "CC BY-SA" },
      curiosidades: null,
      coste: { importe_eur: 10, por: "persona", procedencia: "wikivoyage", fecha: "2026-10-05" },
      guia_intentada_en: "2026-10-05T12:00:00.000Z",
      guia_formato: FORMATO_GUIA,
    });
    // La parada sin ficha queda intentada, sin guía y sin tocar su coste.
    expect(escrituras[1].datos).toEqual({ guia: null, curiosidades: null, guia_intentada_en: "2026-10-05T12:00:00.000Z", guia_formato: FORMATO_GUIA });
  });

  it("un precio de 0 € se guarda como gratis; una ficha sin precio no toca el coste", async () => {
    const { fuente } = fuenteGuiaFalsa({ Sevilla: pagina([ficha("Plaza de España", { precio_eur: 0 }), ficha("Catedral")]) });
    const { cliente, escrituras } = supabaseFalso();

    await enriquecerParadas(cliente, deps(fuente), [fila("p1", "Plaza de España"), fila("p2", "Catedral")]);

    expect(escrituras[0].datos.coste).toMatchObject({ importe_eur: 0, por: "gratis" });
    expect(escrituras[0].datos.guia).toMatchObject({ precio_eur: 0 });
    expect(escrituras[0].datos.guia).not.toHaveProperty("precio_texto");
    expect(escrituras[1].datos).not.toHaveProperty("coste");
    expect(escrituras[1].datos.guia).not.toHaveProperty("precio_eur");
  });

  it("las paradas eligen ficha antes que las alternativas, y una alternativa nunca guarda coste", async () => {
    const { fuente, pedidas } = fuenteGuiaFalsa({
      Sevilla: pagina([ficha("Real Alcázar", { precio_eur: 14 }), ficha("Archivo de Indias", { precio_eur: 5 })]),
    });
    const { cliente, escrituras } = supabaseFalso();

    // La alternativa va primero en la lista y su nombre coincide igual de bien:
    // aun así la ficha es para la parada.
    const r = await enriquecerParadas(cliente, deps(fuente), [
      fila("a1", "Real Alcázar", { tabla: "paradas_alternativas" }),
      fila("p1", "Real Alcázar", { tabla: "paradas" }),
      fila("a2", "Archivo de Indias", { tabla: "paradas_alternativas" }),
    ]);

    expect(pedidas).toHaveLength(1);
    expect(r.con_guia).toBe(2);
    const porId = new Map(escrituras.map((e) => [e.id, e]));
    expect(porId.get("p1")?.datos.guia).toMatchObject({ consejo: "Consejo de Real Alcázar." });
    expect(porId.get("a1")?.datos.guia).toBeNull();
    expect(porId.get("a1")?.tabla).toBe("paradas_alternativas");
    // La alternativa aprovecha la ficha sobrante, pero sin coste.
    expect(porId.get("a2")?.datos.guia).toMatchObject({ consejo: "Consejo de Archivo de Indias.", precio_eur: 5 });
    expect(porId.get("a2")?.datos).not.toHaveProperty("coste");
  });

  it("pide una página por ciudad y ninguna para las paradas sin ciudad", async () => {
    const { fuente, pedidas } = fuenteGuiaFalsa({ Lisboa: pagina([]), Oporto: null });
    const { cliente, escrituras } = supabaseFalso();

    const r = await enriquecerParadas(
      cliente,
      deps(fuente),
      [fila("p1", "A", { ciudad: "Lisboa" }), fila("p2", "B", { ciudad: "Oporto" }), fila("p3", "C", { ciudad: "Lisboa" }), fila("p4", "D", { ciudad: null })],
      12345,
    );

    expect(pedidas).toEqual([
      { ciudad: "Lisboa", hasta: 12345 },
      { ciudad: "Oporto", hasta: 12345 },
    ]);
    expect(r).toMatchObject({ intentadas: 4, con_guia: 0 });
    expect(escrituras).toHaveLength(4);
  });

  it("un fallo de la fuente o quedarse sin ritmo pospone el grupo sin marcarlo; el resto sigue", async () => {
    const { fuente } = fuenteGuiaFalsa({ Lisboa: new FalloFuenteGuia("HTTP 503"), Oporto: new EsperaExcedida("sin hueco"), Faro: pagina([]) });
    const { cliente, escrituras } = supabaseFalso();

    const r = await enriquecerParadas(cliente, deps(fuente), [
      fila("p1", "A", { ciudad: "Lisboa" }),
      fila("p2", "B", { ciudad: "Lisboa" }),
      fila("p3", "C", { ciudad: "Oporto" }),
      fila("p4", "D", { ciudad: "Faro" }),
    ]);

    expect(r).toEqual({ intentadas: 1, con_guia: 0, con_curiosidades: 0, pospuestas: 3 });
    expect(escrituras.map((e) => e.id)).toEqual(["p4"]);
  });

  it("cualquier otro error de la fuente se propaga", async () => {
    const { fuente } = fuenteGuiaFalsa({ Sevilla: new TypeError("bug") });
    const { cliente } = supabaseFalso();

    await expect(enriquecerParadas(cliente, deps(fuente), [fila("p1", "A")])).rejects.toThrow("bug");
  });

  it("un error al guardar se lanza con la tabla en el mensaje", async () => {
    const { fuente } = fuenteGuiaFalsa({});
    const { cliente } = supabaseFalso({ message: "sin permiso" });

    await expect(enriquecerParadas(cliente, deps(fuente), [fila("a1", "A", { tabla: "paradas_alternativas", ciudad: null })])).rejects.toThrow(
      "No se pudo guardar la guía de paradas_alternativas: sin permiso",
    );
  });

  it("guarda curiosidades literales de la página propia en Wikipedia, con su URL", async () => {
    const lugar: Lugar = {
      fuente: "wikipedia",
      id: "wikipedia:es:Real Alcázar de Sevilla",
      url: "https://es.wikipedia.org/wiki/Real_Alc%C3%A1zar_de_Sevilla",
      nombre_fuente: "Real Alcázar de Sevilla",
      etiquetas: {},
      resuelto_en: "2026-10-01T00:00:00Z",
    };
    const fuenteFotos = crearFuenteFotosGrabada({ paginas: { "es:Real Alcázar de Sevilla": { extracto: EXTRACTO } }, imagenes: {} });
    const { fuente } = fuenteGuiaFalsa({});
    const { cliente, escrituras } = supabaseFalso();

    const r = await enriquecerParadas(cliente, deps(fuente, { fuenteFotos }), [fila("p1", "Alcázar", { lugar, ciudad: null })]);

    expect(r.con_curiosidades).toBe(1);
    const curiosidades = escrituras[0].datos.curiosidades as { frases: string[]; url: string };
    expect(curiosidades.url).toBe("https://es.wikipedia.org/wiki/Real_Alc%C3%A1zar_de_Sevilla");
    expect(curiosidades.frases.length).toBeGreaterThan(0);
    const compacto = EXTRACTO.replace(/\s+/g, " ");
    for (const frase of curiosidades.frases) expect(compacto).toContain(frase);
  });

  it("sin página propia, sin extracto o con la fuente de fotos caída no hay curiosidades, y no corta el lote", async () => {
    const lugarOsm: Lugar = { fuente: "osm", id: "osm:1", url: "https://osm.org/1", nombre_fuente: "Bar", etiquetas: {}, resuelto_en: "x" };
    const lugarWiki: Lugar = { ...lugarOsm, fuente: "wikipedia", id: "wikipedia:es:Vacía", nombre_fuente: "Vacía" };
    const lugarCaido: Lugar = { ...lugarWiki, id: "wikipedia:es:Caída", nombre_fuente: "Caída" };
    const fuenteFotos: FuenteFotos = {
      ...sinFotos,
      async resumenPagina(_lang, titulo) {
        if (titulo === "Caída") throw new Error("Wikipedia caída");
        return titulo === "Vacía" ? { extracto: "" } : null;
      },
    };
    const { fuente } = fuenteGuiaFalsa({});
    const { cliente, escrituras } = supabaseFalso();

    const r = await enriquecerParadas(cliente, deps(fuente, { fuenteFotos }), [
      fila("p1", "Bar", { lugar: lugarOsm, ciudad: null }),
      fila("p2", "Vacía", { lugar: lugarWiki, ciudad: null }),
      fila("p3", "Caída", { lugar: lugarCaido, ciudad: null }),
    ]);

    expect(r).toMatchObject({ intentadas: 3, con_curiosidades: 0 });
    expect(escrituras.map((e) => e.datos.curiosidades)).toEqual([null, null, null]);
  });

  it("con curiosidadesAparte no consulta Wikipedia ni escribe la columna", async () => {
    let consultas = 0;
    const fuenteFotos: FuenteFotos = { ...sinFotos, resumenPagina: async () => (consultas++, null) };
    const lugar: Lugar = { fuente: "wikipedia", id: "w", url: "u", nombre_fuente: "X", etiquetas: {}, resuelto_en: "x" };
    const { fuente } = fuenteGuiaFalsa({});
    const { cliente, escrituras } = supabaseFalso();

    await enriquecerParadas(cliente, deps(fuente, { fuenteFotos, curiosidadesAparte: true }), [fila("p1", "X", { lugar, ciudad: null })]);

    expect(consultas).toBe(0);
    expect(escrituras[0].datos).not.toHaveProperty("curiosidades");
  });
});

describe("enriquecerGuiaPendientes y enriquecerGuiaDePlan", () => {
  it("sin versiones no lee nada", async () => {
    const cliente = {
      from: () => {
        throw new Error("no debería consultar");
      },
    } as unknown as SupabaseClient;
    const { fuente } = fuenteGuiaFalsa({});

    expect(await enriquecerGuiaPendientes(cliente, deps(fuente), [], 10)).toEqual({ intentadas: 0, con_guia: 0, con_curiosidades: 0, pospuestas: 0 });
  });

  it("enriquecerGuiaDePlan nunca lanza: un fallo de la base de datos da un resultado vacío", async () => {
    const cliente = {
      from: () => {
        throw new Error("base de datos caída");
      },
    } as unknown as SupabaseClient;
    const { fuente } = fuenteGuiaFalsa({});

    expect(await enriquecerGuiaDePlan(cliente, deps(fuente), "plan-x")).toEqual({ intentadas: 0, con_guia: 0, con_curiosidades: 0, pospuestas: 0 });
  });
});
