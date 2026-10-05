import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { Reloj } from "@/lib/lugares/limitador";
import { calcularEventos, deduplicarYOrdenar, filtrarFestivos, filtrarFiestas, segmentosDe } from "../calcular";
import { crearFuenteFestivos, FalloFuenteEventos } from "../festivos";
import { esFecha, esIdQ, eventoSeguro, limpiarNombre } from "../seguridad";
import type { Evento } from "../tipos";
import { consultaCiudad, crearFuenteWikidata, mesYDia } from "../wikidata";

const grabado = (n: string) => readFileSync(join(process.cwd(), "fixtures/eventos", n), "utf8");
const reloj: Reloj = { ahora: () => 0, dormir: async () => undefined };

interface Peticion {
  url: string;
  cuerpo?: unknown;
  cabeceras?: HeadersInit;
}

// Fetch falso que sirve ficheros grabados de las fuentes reales y anota
// todo lo que sale de la aplicación (privacidad: invariante 4).
function fetchGrabado(peticiones: Peticion[], extra: Partial<Record<string, () => Response>> = {}): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    peticiones.push({ url: u, cuerpo: init?.body, cabeceras: init?.headers });
    const f = Object.entries(extra).find(([k]) => u.includes(k));
    if (f?.[1]) return f[1]();
    if (u.endsWith("/Countries")) return new Response(grabado("openholidays-countries.json"));
    if (u.includes("/PublicHolidays?")) return new Response(grabado("openholidays-pt-festivos.json"));
    if (u.includes("/SchoolHolidays?")) return new Response(grabado("openholidays-pt-escolares.json"));
    if (u.includes("es.wikipedia.org/w/api.php")) return new Response(grabado("wikipedia-pageprops-lisboa.json"));
    if (u.includes("query.wikidata.org/sparql")) return new Response(grabado("wikidata-lisboa.json"));
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

const fuentes = (peticiones: Peticion[], extra?: Partial<Record<string, () => Response>>) => {
  const f = fetchGrabado(peticiones, extra);
  const cache = cacheSitiosMemoria();
  return { festivos: crearFuenteFestivos({ fetch: f, reloj, cache }), wikidata: crearFuenteWikidata({ fetch: f, reloj, cache }) };
};

const SEG = { etapa: 0, ciudad: "Lisboa", desde: "2027-06-08", hasta: "2027-06-15" };

describe("festivos (eve-ac1, datos grabados de OpenHolidays)", () => {
  it("devuelve solo festivos nacionales Public y vacaciones nacionales", async () => {
    const f = crearFuenteFestivos({ fetch: fetchGrabado([]), reloj, cache: cacheSitiosMemoria() });
    const r = await f.festivos("PT", "2027-06-08", "2027-06-15");
    expect(r.filter((e) => e.tipo === "festivo").map((e) => [e.fecha, e.nombre])).toEqual([["2027-06-10", "Portugal Day"]]);
    expect(r.filter((e) => e.tipo === "vacaciones")).toHaveLength(2);
    expect(r.every((e) => e.fuente === "openholidays")).toBe(true);
  });

  it("cae a Nager.Date cuando OpenHolidays no cubre el país", async () => {
    const peticiones: Peticion[] = [];
    const nager = JSON.stringify([
      { date: "2027-01-01", localName: "Año Nuevo", name: "New Year's Day", global: true, types: ["Public"] },
      { date: "2027-01-02", localName: "Local", name: "Local", global: false, types: ["Public"] },
    ]);
    const f = crearFuenteFestivos({
      fetch: fetchGrabado(peticiones, { "date.nager.at": () => new Response(nager) }),
      reloj,
      cache: cacheSitiosMemoria(),
    });
    const r = await f.festivos("ZZ", "2027-01-01", "2027-01-05");
    expect(r).toEqual([{ fecha: "2027-01-01", nombre: "New Year's Day", tipo: "festivo", fuente: "nager", url: "https://date.nager.at/Country/ZZ" }]);
  });

  it("un 429 lanza FalloFuenteEventos y un país inválido no hace peticiones", async () => {
    const peticiones: Peticion[] = [];
    const f = crearFuenteFestivos({ fetch: fetchGrabado(peticiones, { PublicHolidays: () => new Response("", { status: 429 }) }), reloj, cache: cacheSitiosMemoria() });
    await expect(f.festivos("PT", "2027-06-08", "2027-06-15")).rejects.toBeInstanceOf(FalloFuenteEventos);
    const antes = peticiones.length;
    expect(await f.festivos("pt; drop", "2027-06-08", "2027-06-15")).toEqual([]);
    expect(peticiones.length).toBe(antes);
  });
});

describe("wikidata (eve-ac1, eve-ac3)", () => {
  it("resuelve Lisboa por pageprops y lee la fiesta de San Antonio", async () => {
    const c = await crearFuenteWikidata({ fetch: fetchGrabado([]), reloj, cache: cacheSitiosMemoria() }).ciudad("Lisboa");
    expect(c).toMatchObject({ q: "Q597", pais: "PT" });
    expect(c?.fiestas).toEqual([{ nombre: "Saint Anthony's Day", url: "https://www.wikidata.org/wiki/Q112059989", mes: 6, dia: 13 }]);
  });

  it("un identificador no válido no genera ninguna consulta SPARQL", () => {
    expect(() => consultaCiudad("Q1; DROP")).toThrow();
    expect(() => consultaCiudad("Q1 } # ")).toThrow();
    expect(consultaCiudad("Q597")).toContain("wd:Q597");
  });

  it("una página de desambiguación o inexistente devuelve null sin SPARQL", async () => {
    const peticiones: Peticion[] = [];
    const desamb = JSON.stringify({ query: { pages: [{ title: "X", pageprops: { wikibase_item: "Q1", disambiguation: "" } }] } });
    const f = crearFuenteWikidata({ fetch: fetchGrabado(peticiones, { "w/api.php": () => new Response(desamb) }), reloj, cache: cacheSitiosMemoria() });
    expect(await f.ciudad("X")).toBeNull();
    expect(peticiones.some((p) => p.url.includes("sparql"))).toBe(false);
  });

  it("mesYDia lee las dos formas de etiqueta", () => {
    expect(mesYDia("June 13")).toEqual({ mes: 6, dia: 13 });
    expect(mesYDia("13 June")).toEqual({ mes: 6, dia: 13 });
    expect(mesYDia("Foo 3")).toBeNull();
  });
});

describe("calcularEventos (eve-ac1, eve-ac3)", () => {
  it("cp-eve-01: Lisboa 8-15 junio 2027 trae festivo, vacaciones y San Antonio, ordenados y con la fuente", async () => {
    const r = await calcularEventos(fuentes([]), [SEG]);
    expect(r.fallo).toBe(false);
    expect(r.eventos.map((e) => [e.fecha, e.tipo, e.fuente])).toEqual([
      ["2027-06-08", "vacaciones", "openholidays"],
      ["2027-06-10", "festivo", "openholidays"],
      ["2027-06-12", "vacaciones", "openholidays"],
      ["2027-06-13", "fiesta", "wikidata"],
    ]);
    expect(r.eventos.every((e) => eventoSeguro(e))).toBe(true);
  });

  it("un fallo de fuente devuelve fallo:true sin tumbar el resto", async () => {
    const r = await calcularEventos(fuentes([], { "openholidaysapi.org/PublicHolidays": () => new Response("", { status: 503 }) }), [SEG]);
    expect(r.fallo).toBe(true);
  });

  it("invariante privacidad: solo salen ciudad, país y fechas", async () => {
    const peticiones: Peticion[] = [];
    await calcularEventos(fuentes(peticiones), [SEG]);
    const hosts = new Set(peticiones.map((p) => new URL(p.url).hostname));
    expect([...hosts].sort()).toEqual(["es.wikipedia.org", "openholidaysapi.org", "query.wikidata.org"]);
    expect(peticiones.every((p) => p.cuerpo === undefined)).toBe(true);
    const conjunto = peticiones.map((p) => decodeURIComponent(p.url)).join("\n");
    expect(conjunto).not.toMatch(/plan-|usuario|@|presupuesto|perfil/i);
  });

  it("segmentosDe: sin ciudad resuelta no hay segmentos y con fechas dudosas tampoco", () => {
    expect(segmentosDe({ id: "v", ciudad: null, dias: [{ fecha: "2027-06-08" }] })).toEqual([]);
    expect(segmentosDe({ id: "v", ciudad: { estado: "resuelta", metodo: "destino", nombre: "Lisboa", caja: { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 }, intentado_en: "x" }, dias: [{ fecha: "2027-13-40" }] })).toEqual([]);
  });
});

const fechaArb = fc.integer({ min: 0, max: 800 }).map((d) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10));
const rangoArb = fc.tuple(fechaArb, fechaArb).map(([a, b]) => (a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a }));

describe("invariantes (property tests)", () => {
  it("inv1: todo evento filtrado cae dentro del tramo del viaje", () => {
    fc.assert(
      fc.property(rangoArb, fechaArb, fc.option(fechaArb, { nil: undefined }), (tramo, f, fin) => {
        const s = { etapa: 0, ciudad: "X", ...tramo };
        const salida = [
          ...filtrarFestivos([{ fecha: f, ...(fin && fin >= f ? { fecha_fin: fin } : {}), nombre: "n", tipo: "festivo", fuente: "nager", url: "https://date.nager.at/Country/PT" }], s, "PT"),
          ...filtrarFiestas([{ nombre: "n", url: "https://www.wikidata.org/wiki/Q1", mes: Number(f.slice(5, 7)), dia: Number(f.slice(8, 10)) }], s, "PT"),
        ];
        return salida.every((e) => e.fecha >= s.desde && (e.fecha_fin ?? e.fecha) <= s.hasta && e.fecha <= (e.fecha_fin ?? e.fecha));
      }),
    );
  });

  it("inv2: deduplicar es idempotente, sin repetidos y ordenado por fecha", () => {
    const evArb = fc.record({ fecha: fechaArb, nombre: fc.constantFrom("Día A", "dia a", "Día B", "Fiesta"), tipo: fc.constantFrom("festivo", "vacaciones", "fiesta" as const) }).map(
      (r): Evento => ({ ...r, fuente: "openholidays", url: "https://openholidaysapi.org/", etapa: 0 }),
    );
    fc.assert(
      fc.property(fc.array(evArb, { maxLength: 30 }), (lista) => {
        const una = deduplicarYOrdenar(lista);
        expect(deduplicarYOrdenar(una)).toEqual(una);
        expect(una.map((e) => e.fecha)).toEqual([...una.map((e) => e.fecha)].sort());
        return una.length <= lista.length;
      }),
    );
  });

  it("inv5: el nombre limpio es texto plano ≤200 sin marcado, y nada con marcado pasa eventoSeguro", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (t) => {
        const n = limpiarNombre(t);
        return n.length <= 200 && !/[{}[\]<>]/.test(n);
      }),
    );
    expect(eventoSeguro({ fecha: "2027-06-10", nombre: "<b>x</b>", tipo: "festivo", fuente: "nager", url: "https://date.nager.at/x", etapa: 0 })).toBe(false);
    expect(eventoSeguro({ fecha: "2027-06-10", nombre: "x", tipo: "festivo", fuente: "nager", url: "https://evil.example/x", etapa: 0 })).toBe(false);
    expect(eventoSeguro({ fecha: "2027-06-10", nombre: "x", tipo: "festivo", fuente: "nager", url: "javascript:alert(1)", etapa: 0 })).toBe(false);
  });

  it("inv4: solo un identificador Q con forma estricta entra en la consulta", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (t) => {
        if (esIdQ(t)) return consultaCiudad(t).includes(`wd:${t} `);
        expect(() => consultaCiudad(t)).toThrow();
        return true;
      }),
    );
    expect(esFecha("2027-02-30")).toBe(false);
  });
});
