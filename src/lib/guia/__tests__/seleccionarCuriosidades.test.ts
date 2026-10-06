import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EjecutorModelo } from "@/lib/trabajador/ejecutorModelo";
import { LimiteDeUsoAlcanzado } from "@/lib/trabajador/ejecutorModelo";
import { construirCandidatas, type CandidatasSitio, type Candidata } from "../candidatas";
import { ARTICULOS, ENTIDADES, ENTRADILLAS, fuenteGrabada, sitiosLondres } from "../__fixtures__/fuenteGrabada";
import { MAX_CANDIDATAS_PROMPT } from "../promptCuriosidades";
import { elegirPorHeuristica, seleccionarCuriosidades } from "../seleccionarCuriosidades";

const compacto = (t: string) => t.replace(/\s+/g, " ");

function ejecutorContador(responder: (prompt: string) => string | Error) {
  const prompts: string[] = [];
  const ejecutor: EjecutorModelo = {
    async invocar(prompt) {
      prompts.push(prompt);
      const r = responder(prompt);
      if (r instanceof Error) throw r;
      return { texto: r };
    },
  };
  return { ejecutor, prompts };
}

// Las claves del prompt son s1… en el orden de los sitios con candidatas.
function respuestaA(candidatas: CandidatasSitio[]): string {
  const salida: Record<string, string[]> = {};
  let n = 0;
  for (const { sitio, candidatas: cs } of candidatas) {
    if (cs.length === 0) continue;
    n += 1;
    const ids: string[] = [];
    if (sitio.tipo === "parada") {
      ids.push((cs.find((c) => c.fuente === "wikidata") as Candidata).id, (cs.find((c) => c.idioma === "en") as Candidata).id);
      for (const c of cs.filter((c) => c.fuente === "wikipedia" && c.idioma === "es").slice(0, 2)) ids.push(c.id);
    } else {
      ids.push(...cs.slice(0, 2).map((c) => c.id));
    }
    salida[`s${n}`] = ids;
  }
  return JSON.stringify(salida);
}

const construir = () => construirCandidatas(sitiosLondres(), fuenteGrabada());

describe("candidatas (cur-ac1)", () => {
  it("cada frase de Wikipedia es subcadena literal del artículo en su idioma y su url lleva el fragmento", async () => {
    for (const { sitio, candidatas } of await construir()) {
      expect(candidatas.length, sitio.id).toBeGreaterThan(0);
      for (const c of candidatas.filter((c) => c.fuente === "wikipedia")) {
        const textos = Object.entries({ ...ARTICULOS, ...ENTRADILLAS }).filter(([k]) => k.startsWith(`${c.idioma}:`));
        expect(textos.some(([, t]) => compacto(t).includes(c.texto)), c.texto).toBe(true);
        expect(c.url).toMatch(new RegExp(`^https://${c.idioma}\\.wikipedia\\.org/wiki/.+#:~:text=`));
      }
      for (const c of candidatas.filter((c) => c.fuente === "wikidata")) expect(c.url).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
    }
  });

  it("los hechos de Wikidata salen de plantillas fijas y de una propiedad con valor en la entidad", async () => {
    const [museo] = await construir();
    const hechos = museo.candidatas.filter((c) => c.fuente === "wikidata").map((c) => c.texto);
    // La entidad de fixture tiene P571 (1753) y P1619 (1759): solo sale la apertura.
    expect(hechos).toContain("Se inauguró en 1759.");
    expect(hechos.some((h) => h.includes("fund"))).toBe(false);
    expect(hechos.length).toBeLessThanOrEqual(3);
    expect(Object.keys(ENTIDADES)).toContain("Q6373");
  });

  it("una parada llega a 12 candidatas con inglés y una alternativa a 6 como mucho", async () => {
    const todas = await construir();
    for (const { sitio, candidatas } of todas) {
      expect(candidatas.length).toBeLessThanOrEqual(sitio.tipo === "parada" ? 12 : 6);
      expect(new Set(candidatas.map((c) => c.id)).size).toBe(candidatas.length);
    }
    expect(todas[0].candidatas.some((c) => c.idioma === "en")).toBe(true);
  });

  it("un sitio sin QID ni página de Wikipedia se queda sin candidatas", async () => {
    const [vacio] = await construirCandidatas([{ id: "x", tipo: "parada", nombre: "Bar de la esquina", lugar: null }], fuenteGrabada());
    expect(vacio.candidatas).toEqual([]);
  });

  it("sin artículo en castellano usa solo inglés y Wikidata", async () => {
    const fuente = fuenteGrabada();
    const original = fuente.articulo.bind(fuente);
    fuente.articulo = async (lang, titulo) => (lang === "es" ? null : original(lang, titulo));
    const [museo] = await construirCandidatas(sitiosLondres().slice(0, 1), fuente);
    expect(museo.candidatas.some((c) => c.fuente === "wikipedia" && c.idioma === "es")).toBe(false);
    expect(museo.candidatas.some((c) => c.idioma === "en")).toBe(true);
    expect(museo.candidatas.some((c) => c.fuente === "wikidata")).toBe(true);
  });
});

describe("seleccionarCuriosidades (cp-cur-01)", () => {
  it("con el ejecutor A salen 4 por parada y 2 por alternativa, con una sola invocación", async () => {
    const candidatas = await construir();
    const { ejecutor, prompts } = ejecutorContador(() => respuestaA(candidatas));
    const r = await seleccionarCuriosidades(candidatas, ejecutor);
    expect(prompts).toHaveLength(1);
    expect(r.invocaciones).toBe(1);
    expect(r.seleccion).toBe("modelo");
    for (const { sitio } of candidatas) {
      const items = r.porSitio.get(sitio.id)!.items;
      expect(items.length, sitio.id).toBe(sitio.tipo === "parada" ? 4 : 2);
      for (const i of items.filter((i) => i.fuente === "wikipedia")) {
        expect(i.url).toContain("#:~:text=");
        if (i.idioma === "en") expect(i.url.startsWith("https://en.wikipedia.org/")).toBe(true);
      }
      if (sitio.tipo === "parada") {
        expect(items.some((i) => i.fuente === "wikipedia" && i.idioma === "en")).toBe(true);
        expect(items.some((i) => i.fuente === "wikidata" && /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(i.url))).toBe(true);
      }
    }
  });

  it("con el ejecutor B nada inventado llega a un item", async () => {
    const candidatas = await construir();
    const sucio = JSON.stringify({
      s1: ["c99", candidatas[1].candidatas[0].id.replace("c1", "c1"), { id: "c2", es: "traducción libre" }],
      s2: [],
      texto: "El museo tiene un dragón vivo.",
      s99: ["c1"],
    });
    const { ejecutor } = ejecutorContador(() => sucio);
    const r = await seleccionarCuriosidades(candidatas, ejecutor);
    const todos = [...r.porSitio.values()].flatMap((s) => s.items.map((i) => i.texto)).join("\n");
    expect(todos).not.toContain("dragón");
    expect(todos).not.toContain("traducción libre");
    expect(r.invocaciones).toBe(1);
  });

  it("límite de uso, error o JSON inválido caen al respaldo sin lanzar", async () => {
    const candidatas = await construir();
    for (const fallo of [new LimiteDeUsoAlcanzado("2026-10-06T10:00:00Z", null), new Error("boom"), "esto no es json"]) {
      const { ejecutor } = ejecutorContador(() => fallo);
      const r = await seleccionarCuriosidades(candidatas, ejecutor);
      expect(r.invocaciones).toBe(1);
      expect(r.seleccion).toBe("heuristica");
      for (const s of r.porSitio.values()) {
        expect(s.items.length).toBeGreaterThan(0);
        expect(s.items.length).toBeLessThanOrEqual(4);
        expect(s.items.every((i) => i.seleccion === "heuristica")).toBe(true);
        expect(s.vistoPorModelo).toBe(false);
      }
    }
  });

  it("con más de 700 candidatas las que no caben van al respaldo y sigue habiendo una sola invocación", async () => {
    const base = (await construir())[0];
    const grandes: CandidatasSitio[] = Array.from({ length: 4 }, (_, i) => ({
      sitio: { ...base.sitio, id: `g${i}` },
      candidatas: Array.from({ length: 200 }, (_, j) => ({ id: `c${(j % 99) + 1}`, texto: `Frase número ${i}-${j} del año 19${(j % 90) + 10}.`, fuente: "wikipedia" as const, idioma: "es" as const, url: "https://es.wikipedia.org/wiki/X" })),
    }));
    const { ejecutor, prompts } = ejecutorContador(() => "{}");
    const r = await seleccionarCuriosidades(grandes, ejecutor);
    expect(prompts).toHaveLength(1);
    const lineas = prompts[0].split("\n").filter((l) => /^c\d+: /.test(l)).length;
    expect(lineas).toBeLessThanOrEqual(MAX_CANDIDATAS_PROMPT);
    expect(r.porSitio.get("g3")!.items.every((i) => i.seleccion === "heuristica")).toBe(true);
  });
});

describe("invariantes de seguridad (property tests)", () => {
  it("para cualquier salida del modelo, los textos mostrados salen de las candidatas de su sitio", async () => {
    const candidatas = await construir();
    const permitidos = new Map(candidatas.map((c) => [c.sitio.id, new Set(c.candidatas.map((x) => x.texto))]));
    const arbitrario = fc.oneof(
      fc.string(),
      fc.json(),
      fc.dictionary(fc.constantFrom("s1", "s2", "s3", "s4", "s5", "s6", "s99", "texto"), fc.array(fc.oneof(fc.constantFrom("c1", "c2", "c3", "c7", "c12", "c99", "x"), fc.string(), fc.integer()), { maxLength: 8 })).map((d) => JSON.stringify(d)),
    );
    await fc.assert(
      fc.asyncProperty(arbitrario, async (salida) => {
        const { ejecutor } = ejecutorContador(() => salida);
        const r = await seleccionarCuriosidades(candidatas, ejecutor);
        expect(r.invocaciones).toBeLessThanOrEqual(1);
        for (const [id, sel] of r.porSitio) {
          expect(sel.items.length).toBeLessThanOrEqual(4);
          const textos = sel.items.map((i) => i.texto.replace(/\s+/g, " ").toLowerCase());
          expect(new Set(textos).size).toBe(textos.length);
          for (const i of sel.items) {
            expect(permitidos.get(id)!.has(i.texto)).toBe(true);
            expect(i.url.startsWith("https://")).toBe(true);
            expect(["es.wikipedia.org", "en.wikipedia.org", "www.wikidata.org"]).toContain(new URL(i.url).hostname);
            if (i.fuente === "wikipedia") expect(i.url).toContain("#:~:text=");
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it("el respaldo determinista nunca pasa de 4 ni repite y solo usa candidatas", async () => {
    const candidatas = await construir();
    for (const { candidatas: cs } of candidatas) {
      const items = elegirPorHeuristica(cs);
      expect(items.length).toBeLessThanOrEqual(4);
      expect(new Set(items.map((i) => i.texto)).size).toBe(items.length);
      for (const i of items) expect(cs.some((c) => c.texto === i.texto)).toBe(true);
    }
  });
});
