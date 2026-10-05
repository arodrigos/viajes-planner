import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { esUrlFotoValida, fotoSegura, LICENCIAS_COMMONS, licenciaUrlSegura, normalizarUrlFoto } from "../urlFoto";
import { crearFuenteFotosAbierta } from "../fuenteFotosAbierta";
import { crearFuenteFotosGrabada } from "../fuenteFotosGrabada";
import { resolverFoto } from "../resolverFotos";
import type { Lugar } from "@/lib/plan/tipos";
import type { Reloj } from "../limitador";

function fixture(nombre: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, "../../../../fixtures/fotos", nombre), "utf-8"));
}

function respuestaJson(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status });
}

function crearRelojFalso(): Reloj & { esperas: number[] } {
  const estado = {
    esperas: [] as number[],
    ahora: () => 0,
    dormir: async (ms: number) => {
      estado.esperas.push(ms);
    },
  };
  return estado;
}

const RESUMEN_PRADO = fixture("museo-del-prado-resumen.json");
const IMAGEINFO_PRADO = fixture("museo-del-prado-imageinfo.json");
const IMAGEINFO_LICENCIA_NO_LIBRE = fixture("licencia-no-libre-imageinfo.json");
const RESUMEN_SIN_IMAGEN = fixture("articulo-sin-imagen-resumen.json");

describe("crearFuenteFotosAbierta (fot-ac1)", () => {
  it("resuelve una foto real (Museo del Prado) con autor y licencia leídos de extmetadata, no del título", async () => {
    const peticiones: { url: string; headers: Record<string, string> }[] = [];
    const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      if (url.includes("rest_v1/page/summary")) return respuestaJson(RESUMEN_PRADO);
      return respuestaJson(IMAGEINFO_PRADO);
    });
    const fuente = crearFuenteFotosAbierta({ fetch: fetchFalso as unknown as typeof fetch });

    const resumen = await fuente.resumenPagina("es", "Museo del Prado");
    expect(resumen?.fichero).toBe("Museo_del_Prado_2016_(25185969599).jpg");

    const foto = await fuente.infoImagen(resumen!.fichero!);
    expect(foto?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(foto?.autor).toBe("Emilio J. Rodríguez Posada");
    expect(foto?.licencia).toBe("CC BY-SA 2.0");
    expect(foto?.licencia_url).toBe("https://creativecommons.org/licenses/by-sa/2.0");
    expect(foto?.pagina_url).toBe("https://commons.wikimedia.org/wiki/File:Museo_del_Prado_2016_(25185969599).jpg");
    expect(foto?.fuente).toBe("commons");

    for (const peticion of peticiones) {
      expect(peticion.headers["user-agent"]).toMatch(
        /^viajes-planner\/\S+ \(\+https:\/\/github\.com\/arodrigos\/viajes-planner\)$/,
      );
    }
  });

  it("rechaza un fichero con licencia no libre: sin foto, nunca un pin a medias", async () => {
    const fetchFalso = vi.fn(async () => respuestaJson(IMAGEINFO_LICENCIA_NO_LIBRE));
    const fuente = crearFuenteFotosAbierta({ fetch: fetchFalso as unknown as typeof fetch });

    const foto = await fuente.infoImagen("Foto con todos los derechos reservados.jpg");
    expect(foto).toBeNull();
  });

  it("un artículo real sin pageimage no da fichero", async () => {
    const fetchFalso = vi.fn(async () => respuestaJson(RESUMEN_SIN_IMAGEN));
    const fuente = crearFuenteFotosAbierta({ fetch: fetchFalso as unknown as typeof fetch });

    const resumen = await fuente.resumenPagina("es", "Artículo de ejemplo sin imagen asociada");
    expect(resumen?.fichero).toBeUndefined();
  });

  it("ante un 429 espera 30.000 ms y reintenta exactamente una vez", async () => {
    const reloj = crearRelojFalso();
    let llamada = 0;
    const fetchFalso = vi.fn(async () => {
      llamada++;
      if (llamada === 1) return respuestaJson({ error: "demasiadas peticiones" }, 429);
      return respuestaJson(IMAGEINFO_PRADO);
    });
    const fuente = crearFuenteFotosAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj });

    const foto = await fuente.infoImagen("Museo_del_Prado_2016_(25185969599).jpg");

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(reloj.esperas).toContain(30_000);
    expect(foto?.licencia).toBe("CC BY-SA 2.0");
  });
});

describe("resolverFoto (fot-ac3): nunca una foto de otro sitio", () => {
  const FOTO_CATEDRAL = {
    url: "https://upload.wikimedia.org/catedral.jpg",
    fichero: "Catedral.jpg",
    autor: "Autor Catedral",
    licencia: "CC BY-SA 4.0",
    licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina_url: "https://commons.wikimedia.org/wiki/File:Catedral.jpg",
    fuente: "commons" as const,
  };
  const FOTO_MIRADOR_CERCANO = { ...FOTO_CATEDRAL, fichero: "Mirador.jpg", pagina_url: "https://commons.wikimedia.org/wiki/File:Mirador.jpg" };

  it("un restaurante a 20 m de una catedral con foto NO recibe la foto de la catedral (sin página propia, categoría no es 'de ver')", async () => {
    const fuente = crearFuenteFotosGrabada({
      paginas: {},
      imagenes: { "Catedral.jpg": FOTO_CATEDRAL },
      geosearch: { "40.1,-3.1": [{ lang: "es", titulo: "Catedral" }] },
    });
    const foto = await resolverFoto(fuente, undefined, "comida", { lat: 40.1, lon: -3.1 });
    expect(foto).toBeUndefined();
  });

  it("un mirador sin artículo propio a 80 m de un artículo con imagen SÍ recibe esa foto (categoría 'de ver')", async () => {
    const fuente = crearFuenteFotosGrabada({
      paginas: { "es:Mirador cercano": { fichero: "Mirador.jpg" } },
      imagenes: { "Mirador.jpg": FOTO_MIRADOR_CERCANO },
      geosearch: { "40.2,-3.2": [{ lang: "es", titulo: "Mirador cercano" }] },
    });
    const foto = await resolverFoto(fuente, undefined, "mirador", { lat: 40.2, lon: -3.2 });
    expect(foto?.fichero).toBe("Mirador.jpg");
  });

  it("prioriza la página propia del lugar resuelto por Wikipedia sobre el geosearch", async () => {
    const lugar: Lugar = {
      fuente: "wikipedia",
      id: "wikipedia:es:Museo del Prado",
      url: "https://es.wikipedia.org/wiki/Museo_del_Prado",
      nombre_fuente: "Museo del Prado",
      etiquetas: {},
      resuelto_en: "2026-10-04T00:00:00.000Z",
    };
    const fuente = crearFuenteFotosGrabada({
      paginas: { "es:Museo del Prado": { fichero: "Prado.jpg" } },
      imagenes: { "Prado.jpg": { ...FOTO_CATEDRAL, fichero: "Prado.jpg" } },
      geosearch: { "40.1,-3.1": [{ lang: "es", titulo: "Otro sitio cercano" }] },
    });
    const foto = await resolverFoto(fuente, lugar, "museo", { lat: 40.1, lon: -3.1 });
    expect(foto?.fichero).toBe("Prado.jpg");
  });

  it("usa la etiqueta wikipedia de OSM cuando el lugar resolvió por Nominatim", async () => {
    const lugar: Lugar = {
      fuente: "osm",
      id: "osm:way/1",
      url: "https://www.openstreetmap.org/way/1",
      nombre_fuente: "Museo del Prado",
      etiquetas: { wikipedia: "es:Museo del Prado" },
      resuelto_en: "2026-10-04T00:00:00.000Z",
    };
    const fuente = crearFuenteFotosGrabada({
      paginas: { "es:Museo del Prado": { fichero: "Prado.jpg" } },
      imagenes: { "Prado.jpg": { ...FOTO_CATEDRAL, fichero: "Prado.jpg" } },
    });
    const foto = await resolverFoto(fuente, lugar, "museo", { lat: 40.1, lon: -3.1 });
    expect(foto?.fichero).toBe("Prado.jpg");
  });

  it("sin página propia, sin categoría 'de ver' o sin coordenadas: nunca llama a geosearch", async () => {
    let llamadasGeosearch = 0;
    const fuente = crearFuenteFotosGrabada({ paginas: {}, imagenes: {} });
    const original = fuente.geosearch.bind(fuente);
    fuente.geosearch = async (lat, lon) => {
      llamadasGeosearch++;
      return original(lat, lon);
    };

    await resolverFoto(fuente, undefined, "comida", { lat: 40, lon: -3 });
    await resolverFoto(fuente, undefined, "museo", undefined);

    expect(llamadasGeosearch).toBe(0);
  });
});

// alc-ac5: una URL de foto solo se guarda y se pinta si es del CDN de Wikimedia por https.
describe("urlFoto (alc-ac5)", () => {
  it.each([
    ["https://upload.wikimedia.org/wikipedia/commons/a/ab/Foto.jpg", true],
    ["https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foto.jpg/640px-Foto.jpg?utm_source=x", true],
    ["http://upload.wikimedia.org/wikipedia/commons/a/ab/Foto.jpg", false],
    ["https://upload.wikimedia.org.evil.com/Foto.jpg", false],
    ["https://upload.wikimedia.org@evil.com/Foto.jpg", false],
    ["https://evil.com/https://upload.wikimedia.org/Foto.jpg", false],
    ["https://commons.wikimedia.org/Foto.jpg", false],
    ["javascript:alert(1)", false],
    ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", false],
    ["//upload.wikimedia.org/Foto.jpg", false],
    ["", false],
  ])("%s -> %s", (url, esperado) => {
    expect(esUrlFotoValida(url)).toBe(esperado);
  });

  it("fotoSegura conserva autor y licencia de una URL válida y descarta la hostil", () => {
    const base = { fichero: "F.jpg", autor: "Ana", licencia: "CC BY 4.0", licencia_url: "https://creativecommons.org/licenses/by/4.0", pagina_url: "https://commons.wikimedia.org/wiki/File:F.jpg", fuente: "commons" as const };
    const buena = { ...base, url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/F.jpg" };
    expect(fotoSegura(buena)).toEqual(buena);
    expect(fotoSegura({ ...base, url: "http://upload.wikimedia.org/F.jpg" })).toBeUndefined();
    expect(fotoSegura(null)).toBeUndefined();
  });

  it("normalizarUrlFoto lleva las miniaturas de thumb.wikimedia.org al host aceptado", () => {
    const url = normalizarUrlFoto("https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/F.jpg/960px-F.jpg");
    expect(url).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/F.jpg/960px-F.jpg");
    expect(esUrlFotoValida(url)).toBe(true);
  });

  it("invariante 4: sobre cadenas arbitrarias, lo aceptado empieza siempre por https://upload.wikimedia.org/", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string().map((resto) => `https://upload.wikimedia.org/${resto}`), fc.webUrl()), (url) => {
        if (esUrlFotoValida(url)) expect(url.startsWith("https://upload.wikimedia.org/")).toBe(true);
      }),
    );
  });

  it("#97: licencia_url solo es https; javascript:, http: o basura acaban en la página de licencias de Commons", () => {
    expect(licenciaUrlSegura("https://creativecommons.org/licenses/by-sa/4.0")).toBe("https://creativecommons.org/licenses/by-sa/4.0");
    expect(licenciaUrlSegura("//creativecommons.org/licenses/by/2.0")).toBe("https://creativecommons.org/licenses/by/2.0");
    for (const hostil of ["javascript:alert(1)", "http://creativecommons.org/x", "data:text/html,x", "https://u:p@evil.example/", "", undefined, 42]) {
      expect(licenciaUrlSegura(hostil)).toBe(LICENCIAS_COMMONS);
    }
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.webUrl()), (url) => {
        expect(licenciaUrlSegura(url).startsWith("https://")).toBe(true);
      }),
    );
  });

  it("#97: infoImagen fuerza la licencia de Commons cuando LicenseUrl no es https", async () => {
    const hostil = JSON.parse(JSON.stringify(IMAGEINFO_PRADO));
    const pagina = Object.values(hostil.query.pages)[0] as { imageinfo: Array<{ extmetadata: { LicenseUrl?: { value: string } } }> };
    pagina.imageinfo[0].extmetadata.LicenseUrl = { value: "javascript:alert(document.cookie)" };
    const fuente = crearFuenteFotosAbierta({ fetch: (async () => respuestaJson(hostil)) as typeof fetch, reloj: crearRelojFalso() });
    const foto = await fuente.infoImagen("Museo del Prado 2016 (25185969599).jpg");
    expect(foto?.url.startsWith("https://upload.wikimedia.org/")).toBe(true);
    expect(foto?.licencia_url).toBe(LICENCIAS_COMMONS);
  });

  it("#97: fotoSegura sanea la licencia de una foto ya guardada", () => {
    const guardada = { url: "https://upload.wikimedia.org/a.jpg", fichero: "a.jpg", autor: "Ana", licencia: "CC BY 4.0", licencia_url: "javascript:alert(1)", pagina_url: "https://commons.wikimedia.org/wiki/File:a.jpg", fuente: "commons" as const };
    expect(fotoSegura(guardada)?.licencia_url).toBe(LICENCIAS_COMMONS);
  });

  it("infoImagen no devuelve una foto cuya URL no es de Wikimedia", async () => {
    const hostil = JSON.parse(JSON.stringify(IMAGEINFO_PRADO));
    const pagina = Object.values(hostil.query.pages)[0] as { imageinfo: Array<{ url: string; thumburl: string }> };
    pagina.imageinfo[0].thumburl = "http://evil.example/foto.jpg";
    pagina.imageinfo[0].url = "javascript:alert(1)";
    const fuente = crearFuenteFotosAbierta({ fetch: (async () => respuestaJson(hostil)) as typeof fetch, reloj: crearRelojFalso() });
    expect(await fuente.infoImagen("Museo del Prado 2016 (25185969599).jpg")).toBeNull();
  });
});
