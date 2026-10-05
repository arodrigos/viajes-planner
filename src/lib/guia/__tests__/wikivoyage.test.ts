import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { Reloj } from "@/lib/lugares/limitador";
import { crearFuenteGuiaAbierta, EsperaExcedida, FalloFuenteGuia, INTERVALO_MIN_MS } from "../wikivoyage";

function grabado(nombre: string): string {
  return readFileSync(join(process.cwd(), "fixtures/guia", nombre), "utf8");
}

const VACIA = JSON.stringify({ batchcomplete: true, query: { pages: [{ title: "X", missing: true }] } });

function relojFalso(): Reloj & { tiempo: number } {
  const r = {
    tiempo: 1_000_000,
    ahora: () => r.tiempo,
    dormir: async (ms: number) => {
      r.tiempo += ms;
    },
  };
  return r;
}

// Fetch falso que responde por idioma+título con los JSON grabados y anota
// cuándo (según el reloj falso) y a qué URL se pidió.
function fetchFalso(reloj: { ahora(): number }, respuestas: Record<string, string>, estado = 200) {
  const llamadas: Array<{ url: string; en: number; ua: string | undefined }> = [];
  const impl = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    const cabeceras = init?.headers as Record<string, string> | undefined;
    llamadas.push({ url, en: reloj.ahora(), ua: cabeceras?.["User-Agent"] });
    const u = new URL(url);
    const clave = `${u.hostname.split(".")[0]}:${u.searchParams.get("titles")}`;
    return new Response(respuestas[clave] ?? VACIA, { status: estado });
  }) as typeof fetch;
  return { impl, llamadas };
}

describe("crearFuenteGuiaAbierta (gui-ac3)", () => {
  it("Sevilla: es sin fichas → cae a en y devuelve las fichas grabadas", async () => {
    const reloj = relojFalso();
    const f = fetchFalso(reloj, { "es:Sevilla": grabado("es-Sevilla.json"), "en:Sevilla": grabado("en-Seville.json") });
    const fuente = crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache: cacheSitiosMemoria() });
    const pagina = await fuente.paginaCiudad("Sevilla");
    expect(pagina?.idioma).toBe("en");
    expect(pagina?.url).toBe("https://en.wikivoyage.org/wiki/Seville");
    expect(pagina?.fichas.map((x) => x.nombre)).toContain("Real Alcázar");
    expect(f.llamadas).toHaveLength(2);
  });

  it("lleva User-Agent de la app y solo el nombre de la ciudad", async () => {
    const reloj = relojFalso();
    const f = fetchFalso(reloj, { "es:Lisboa": VACIA });
    await crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache: cacheSitiosMemoria() }).paginaCiudad("Lisboa").catch(() => null);
    const u = new URL(f.llamadas[0].url);
    expect(f.llamadas[0].ua).toBeTruthy();
    expect(u.searchParams.get("titles")).toBe("Lisboa");
    expect(u.hostname).toBe("es.wikivoyage.org");
  });

  it("3 ciudades → 3 peticiones (por idioma) separadas ≥ 30.000 ms; repetir → 0 peticiones", async () => {
    const reloj = relojFalso();
    const f = fetchFalso(reloj, { "es:Roma": grabado("en-Seville.json"), "es:Paris": grabado("en-Seville.json"), "es:Lisboa": grabado("en-Seville.json") });
    const cache = cacheSitiosMemoria();
    const fuente = crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache });
    for (const c of ["Roma", "Paris", "Lisboa"]) await fuente.paginaCiudad(c);
    expect(f.llamadas).toHaveLength(3);
    for (let i = 1; i < f.llamadas.length; i++) expect(f.llamadas[i].en - f.llamadas[i - 1].en).toBeGreaterThanOrEqual(INTERVALO_MIN_MS);

    // Otra instancia (otro tick) con la misma caché: cero peticiones.
    const f2 = fetchFalso(reloj, {});
    const otra = crearFuenteGuiaAbierta({ fetch: f2.impl, reloj, cache });
    for (const c of ["Roma", "Paris", "Lisboa"]) expect((await otra.paginaCiudad(c))?.fichas.length).toBeGreaterThan(0);
    expect(f2.llamadas).toHaveLength(0);
  });

  it("la ausencia de página también se cachea", async () => {
    const reloj = relojFalso();
    const f = fetchFalso(reloj, {});
    const cache = cacheSitiosMemoria();
    const fuente = crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache });
    expect(await fuente.paginaCiudad("Nowhere")).toBeNull();
    const n = f.llamadas.length;
    expect(await fuente.paginaCiudad("Nowhere")).toBeNull();
    expect(f.llamadas.length).toBe(n);
  });

  it("un 429 lanza FalloFuenteGuia y no cachea nada", async () => {
    const reloj = relojFalso();
    const cache = cacheSitiosMemoria();
    const malo = fetchFalso(reloj, {}, 429);
    await expect(crearFuenteGuiaAbierta({ fetch: malo.impl, reloj, cache }).paginaCiudad("Roma")).rejects.toBeInstanceOf(FalloFuenteGuia);
    const bueno = fetchFalso(reloj, { "es:Roma": grabado("en-Seville.json") });
    expect((await crearFuenteGuiaAbierta({ fetch: bueno.impl, reloj, cache }).paginaCiudad("Roma"))?.fichas.length).toBeGreaterThan(0);
    expect(bueno.llamadas).toHaveLength(1);
  });

  it("si el hueco de ritmo no cabe antes de `hasta`, lanza EsperaExcedida sin pedir", async () => {
    const reloj = relojFalso();
    const f = fetchFalso(reloj, { "es:Roma": VACIA, "en:Roma": VACIA });
    const fuente = crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache: cacheSitiosMemoria() });
    await fuente.paginaCiudad("Roma");
    const antes = f.llamadas.length;
    await expect(fuente.paginaCiudad("Paris", reloj.ahora() + 1_000)).rejects.toBeInstanceOf(EsperaExcedida);
    expect(f.llamadas.length).toBe(antes);
  });
});

describe("invariante 5: ritmo ≥ 30.000 ms y caché vigente sin peticiones", () => {
  it("para cualquier secuencia de ciudades", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom("Roma", "Paris", "Lisboa", "Sevilla"), { minLength: 1, maxLength: 12 }), async (ciudades) => {
        const reloj = relojFalso();
        const f = fetchFalso(reloj, { "es:Roma": grabado("en-Seville.json"), "es:Paris": VACIA, "en:Paris": VACIA, "es:Lisboa": grabado("en-Seville.json"), "es:Sevilla": VACIA, "en:Sevilla": VACIA });
        const fuente = crearFuenteGuiaAbierta({ fetch: f.impl, reloj, cache: cacheSitiosMemoria() });
        for (const c of ciudades) await fuente.paginaCiudad(c);
        for (let i = 1; i < f.llamadas.length; i++) expect(f.llamadas[i].en - f.llamadas[i - 1].en).toBeGreaterThanOrEqual(INTERVALO_MIN_MS);
        const n = f.llamadas.length;
        for (const c of ciudades) await fuente.paginaCiudad(c);
        expect(f.llamadas.length).toBe(n);
      }),
      { numRuns: 40 },
    );
  });
});
