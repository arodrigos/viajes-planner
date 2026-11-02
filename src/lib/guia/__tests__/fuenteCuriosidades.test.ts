import { describe, expect, it } from "vitest";
import type { Reloj } from "@/lib/lugares/limitador";
import { crearFuenteCuriosidadesWikimedia, FalloFuenteCuriosidades } from "../fuenteCuriosidades";

// Reloj que no duerme de verdad: anota cada pausa para comprobar el ritmo y
// los reintentos sin esperar 30 s.
function relojFalso(): Reloj & { pausas: number[] } {
  const r = {
    pausas: [] as number[],
    ahora: () => 0,
    dormir: async (ms: number) => {
      r.pausas.push(ms);
    },
  };
  return r;
}

type Respuesta = { cuerpo?: unknown; estado?: number } | Error;

// Fetch falso: responde en orden a cada petición y anota URL y User-Agent.
// Nunca sale a la red.
function fetchEnCola(respuestas: Respuesta[]) {
  const llamadas: Array<{ url: string; ua: string | undefined }> = [];
  const impl = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    llamadas.push({ url: String(entrada), ua: (init?.headers as Record<string, string> | undefined)?.["User-Agent"] });
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error("petición inesperada");
    if (siguiente instanceof Error) throw siguiente;
    return new Response(JSON.stringify(siguiente.cuerpo ?? {}), { status: siguiente.estado ?? 200 });
  }) as typeof fetch;
  return { impl, llamadas };
}

const declaracion = (value: unknown, extra: Record<string, unknown> = {}) => ({ mainsnak: { datavalue: { value } }, ...extra });
const tiempo = (time: string) => ({ time });
const cantidad = (amount: string) => ({ amount });
const entidad = (id: string) => ({ id });

describe("crearFuenteCuriosidadesWikimedia · entidades", () => {
  it("convierte declaraciones de Wikidata en hechos y resuelve etiquetas de arquitecto y protección", async () => {
    const { impl, llamadas } = fetchEnCola([
      {
        cuerpo: {
          entities: {
            Q1: {
              id: "Q1",
              claims: {
                P31: [declaracion(entidad("Q33506")), declaracion(entidad("Q999"), { rank: "deprecated" }), declaracion("no-es-entidad")],
                P571: [declaracion(tiempo("+1364-00-00T00:00:00Z"))],
                P1619: [declaracion(tiempo("+1931-04-14T00:00:00Z"))],
                P84: [declaracion(entidad("Q10")), declaracion(entidad("Q11"), { rank: "deprecated" }), declaracion(entidad("Q12"))],
                P2048: [declaracion(cantidad("+87.5"))],
                P1435: [declaracion(entidad("Q20"))],
                P1174: [
                  declaracion(cantidad("+1000"), { qualifiers: { P585: [{ datavalue: { value: tiempo("+2015-01-01T00:00:00Z") } }] } }),
                  declaracion(cantidad("+2500"), { qualifiers: { P585: [{ datavalue: { value: tiempo("+2019-01-01T00:00:00Z") } }] } }),
                  declaracion(cantidad("+9999")),
                ],
              },
              sitelinks: { eswiki: { title: "Alhambra" }, enwiki: { title: "Alhambra" } },
            },
          },
        },
      },
      {
        cuerpo: {
          entities: {
            Q10: { labels: { es: { value: "Arquitecta" }, en: { value: "Architect" } } },
            // Sin etiqueta en castellano se usa la inglesa.
            Q12: { labels: { en: { value: "Builder" } } },
            Q20: { labels: { es: { value: "Patrimonio de la Humanidad" } } },
          },
        },
      },
    ]);
    const reloj = relojFalso();
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj, pausaMs: 250 });

    const resultado = await fuente.entidades(["Q1"]);

    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].url).toContain("action=wbgetentities&ids=Q1&props=claims|sitelinks");
    // El valor obsoleto (Q11) no se pide.
    expect(llamadas[1].url).toContain("ids=Q10|Q12|Q20&props=labels");
    expect(llamadas.every((l) => l.ua?.startsWith("viajes-planner/"))).toBe(true);
    // Una pausa entre la primera y la segunda petición, ninguna antes de la primera.
    expect(reloj.pausas).toEqual([250]);

    const q1 = resultado.get("Q1");
    expect(q1?.clases).toEqual(["Q33506"]);
    expect(q1?.titulos).toEqual({ es: "Alhambra", en: "Alhambra" });
    expect(q1?.hechos).toEqual([
      { propiedad: "P571", anio: 1364 },
      { propiedad: "P1619", anio: 1931 },
      { propiedad: "P84", etiquetas: ["Arquitecta", "Builder"] },
      { propiedad: "P2048", numero: 87.5 },
      { propiedad: "P1435", etiquetas: ["Patrimonio de la Humanidad"] },
      // La medida más reciente gana; la que no tiene fecha queda la última.
      { propiedad: "P1174", numero: 2500, anioMedida: 2019 },
    ]);
  });

  it("descarta años antes de Cristo, cantidades no numéricas y propiedades vacías", async () => {
    const { impl, llamadas } = fetchEnCola([
      {
        cuerpo: {
          entities: {
            Q2: {
              claims: {
                P571: [declaracion(tiempo("-0500-00-00T00:00:00Z"))],
                P1619: [declaracion({ time: 1931 })],
                P2048: [declaracion(cantidad("alto"))],
                P1174: [declaracion(cantidad("NaN"))],
                P84: [],
              },
            },
          },
        },
      },
    ]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    const q2 = (await fuente.entidades(["Q2"])).get("Q2");

    // Sin valores de tipo entidad no hay segunda petición de etiquetas.
    expect(llamadas).toHaveLength(1);
    expect(q2).toEqual({ qid: "Q2", clases: [], titulos: {}, hechos: [] });
  });

  it("un P1174 sin fecha de medida no inventa el año", async () => {
    const { impl } = fetchEnCola([{ cuerpo: { entities: { Q3: { claims: { P1174: [declaracion(cantidad("+42"))] } } } } }]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    const q3 = (await fuente.entidades(["Q3"])).get("Q3");

    expect(q3?.hechos).toEqual([{ propiedad: "P1174", numero: 42 }]);
  });

  it("un arquitecto sin etiqueta en ningún idioma no produce hecho", async () => {
    const { impl } = fetchEnCola([
      { cuerpo: { entities: { Q4: { claims: { P84: [declaracion(entidad("Q40"))] } } } } },
      { cuerpo: { entities: { Q40: { labels: {} } } } },
    ]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    expect((await fuente.entidades(["Q4"])).get("Q4")?.hechos).toEqual([]);
  });

  it("pide las entidades en lotes de 50", async () => {
    const qids = Array.from({ length: 51 }, (_, i) => `Q${i + 1}`);
    const { impl, llamadas } = fetchEnCola([{ cuerpo: { entities: {} } }, { cuerpo: {} }]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    const resultado = await fuente.entidades(qids);

    expect(resultado.size).toBe(0);
    expect(llamadas).toHaveLength(2);
    expect(new URL(llamadas[0].url).searchParams.get("ids")?.split("|")).toHaveLength(50);
    expect(new URL(llamadas[1].url).searchParams.get("ids")).toBe("Q51");
  });

  it("sin pausa configurada no duerme entre peticiones", async () => {
    const { impl } = fetchEnCola([
      { cuerpo: { entities: { Q5: { claims: { P1435: [declaracion(entidad("Q50"))] } } } } },
      { cuerpo: { entities: { Q50: { labels: { es: { value: "BIC" } } } } } },
    ]);
    const reloj = relojFalso();
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj, pausaMs: 0 });

    await fuente.entidades(["Q5"]);

    expect(reloj.pausas).toEqual([]);
  });
});

describe("crearFuenteCuriosidadesWikimedia · fallos de la fuente", () => {
  it("un 429 espera 30 s y reintenta una vez; si responde, sigue", async () => {
    const { impl, llamadas } = fetchEnCola([{ estado: 429 }, { cuerpo: { query: { pages: [{ title: "Prado", extract: "Texto." }] } } }]);
    const reloj = relojFalso();
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj });

    expect(await fuente.articulo("es", "Prado")).toBe("Texto.");
    expect(llamadas).toHaveLength(2);
    expect(reloj.pausas).toEqual([30_000]);
  });

  it("un 5xx repetido es un fallo de la fuente, no «sin curiosidades»", async () => {
    const { impl, llamadas } = fetchEnCola([{ estado: 503 }, { estado: 502 }]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    await expect(fuente.articulo("es", "Prado")).rejects.toThrow(new FalloFuenteCuriosidades("HTTP 502"));
    expect(llamadas).toHaveLength(2);
  });

  it("un 404 no se reintenta y también es fallo de la fuente", async () => {
    const { impl, llamadas } = fetchEnCola([{ estado: 404 }]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    await expect(fuente.entidades(["Q1"])).rejects.toBeInstanceOf(FalloFuenteCuriosidades);
    expect(llamadas).toHaveLength(1);
  });

  it("un error de red se envuelve como FalloFuenteCuriosidades con su mensaje", async () => {
    const { impl } = fetchEnCola([new TypeError("socket colgado")]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    const error = await fuente.entradillas("en", ["Prado"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FalloFuenteCuriosidades);
    expect((error as Error).message).toBe("socket colgado");
  });

  it("algo lanzado que no es un Error se convierte en «fallo de red»", async () => {
    const impl = (async () => {
      throw "cadena";
    }) as unknown as typeof fetch;
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    await expect(fuente.articulo("es", "X")).rejects.toThrow(new FalloFuenteCuriosidades("fallo de red"));
  });
});

describe("crearFuenteCuriosidadesWikimedia · artículos y entradillas", () => {
  it("articulo pide el texto completo y devuelve null si la página falta o no tiene extracto", async () => {
    const { impl, llamadas } = fetchEnCola([
      { cuerpo: { query: { pages: [{ title: "No existe", missing: true }] } } },
      { cuerpo: { query: { pages: [{ title: "Vacía" }] } } },
      { cuerpo: {} },
    ]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    expect(await fuente.articulo("es", "No existe")).toBeNull();
    expect(await fuente.articulo("es", "Vacía")).toBeNull();
    expect(await fuente.articulo("en", "Sin query")).toBeNull();
    expect(llamadas[0].url.startsWith("https://es.wikipedia.org/w/api.php?")).toBe(true);
    expect(llamadas[0].url).not.toContain("exintro");
    expect(llamadas[2].url.startsWith("https://en.wikipedia.org/")).toBe(true);
  });

  it("entradillas devuelve cada texto por el título pedido, siguiendo normalización y redirección", async () => {
    const { impl, llamadas } = fetchEnCola([
      {
        cuerpo: {
          query: {
            normalized: [{ from: "museo del prado", to: "Museo del Prado" }],
            redirects: [
              { from: "Museo del Prado", to: "Museo Nacional del Prado" },
              { from: "Alhambra (Granada)", to: "Alhambra" },
            ],
            pages: [
              { title: "Museo Nacional del Prado", extract: "Pinacoteca." },
              { title: "Alhambra", extract: "Palacio nazarí." },
              { title: "Inexistente", missing: true },
            ],
          },
        },
      },
    ]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    const entradillas = await fuente.entradillas("es", ["museo del prado", "Alhambra (Granada)", "Inexistente"]);

    expect([...entradillas]).toEqual([
      ["museo del prado", "Pinacoteca."],
      ["Alhambra (Granada)", "Palacio nazarí."],
    ]);
    const url = new URL(llamadas[0].url);
    expect(url.searchParams.get("exintro")).toBe("1");
    expect(url.searchParams.get("exlimit")).toBe("3");
    expect(url.searchParams.get("titles")).toBe("museo del prado|Alhambra (Granada)|Inexistente");
  });

  it("entradillas de una lista vacía no hace ninguna petición", async () => {
    const { impl, llamadas } = fetchEnCola([]);
    const fuente = crearFuenteCuriosidadesWikimedia({ fetch: impl, reloj: relojFalso() });

    expect((await fuente.entradillas("es", [])).size).toBe(0);
    expect(llamadas).toHaveLength(0);
  });
});
