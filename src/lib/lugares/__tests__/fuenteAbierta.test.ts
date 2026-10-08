import { describe, expect, it, vi } from "vitest";
import { crearFuenteAbierta } from "../fuenteAbierta";
import { cacheSitiosMemoria } from "../cacheSitios";
import type { Reloj } from "../limitador";

// lug-ac3: reloj falso -nunca se espera de verdad en el test, pero se
// registran las marcas de tiempo con las que se habría esperado.
function crearRelojFalso(): Reloj & { tiempo: number; esperas: number[] } {
  const estado = {
    tiempo: 0,
    esperas: [] as number[],
    ahora: () => estado.tiempo,
    dormir: async (ms: number) => {
      estado.esperas.push(ms);
      estado.tiempo += ms;
    },
  };
  return estado;
}

function respuestaJson(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status });
}

const CANDIDATO_NOMINATIM = {
  osm_type: "way",
  osm_id: 1,
  lat: "40.41",
  lon: "-3.69",
  category: "tourism",
  type: "museum",
  display_name: "Museo del Prado, Madrid",
  namedetails: { name: "Museo del Prado" },
  extratags: {},
};

describe("crearFuenteAbierta (lug-ac3)", () => {
  it("manda un User-Agent honesto en cada petición y respeta >= 1.100 ms entre peticiones a Nominatim", async () => {
    const reloj = crearRelojFalso();
    const peticiones: { url: string; headers: Record<string, string> }[] = [];
    const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]);
    });

    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);
    await fuente.buscarNominatim("Palacio Real", "Madrid", bbox);
    await fuente.buscarNominatim("Retiro", "Madrid", bbox);

    expect(peticiones).toHaveLength(3);
    for (const peticion of peticiones) {
      expect(peticion.headers["user-agent"]).toMatch(
        /^viajes-planner\/\S+ \(\+https:\/\/github\.com\/arodrigos\/viajes-planner\)$/,
      );
    }
    // Dos peticiones -> un intervalo esperado (>= 1.100 ms); con tres
    // peticiones, dos intervalos.
    const esperasDeRitmo = reloj.esperas.filter((ms) => ms >= 1100);
    expect(esperasDeRitmo).toHaveLength(2);
  });

  it("una búsqueda repetida (mismo destino y nombre normalizado) se sirve de caché sin petición nueva", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () =>
      respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]),
    );
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);
    await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);
    await fuente.buscarNominatim("museo DEL prado", "madrid", bbox);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("también cachea un resultado negativo, sin petición nueva en la repetición", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson([]));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    const primera = await fuente.buscarNominatim("Sitio Inexistente", "Madrid", bbox);
    const segunda = await fuente.buscarNominatim("Sitio Inexistente", "Madrid", bbox);

    expect(primera).toEqual([]);
    expect(segunda).toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("ante un 429 espera 30.000 ms y reintenta exactamente una vez", async () => {
    const reloj = crearRelojFalso();
    let llamada = 0;
    const fetchFalso = vi.fn(async () => {
      llamada++;
      if (llamada === 1) return respuestaJson({ error: "demasiadas peticiones" }, 429);
      return respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]);
    });
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    const resultado = await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(reloj.esperas).toContain(30_000);
    expect(resultado).toHaveLength(1);
  });

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): un fallo de red NO es una
  // respuesta negativa legítima. Antes se cacheaba como [] y la parada
  // quedaba "no-resuelta" (congelada 30 días); ahora lanza y resolverNombre
  // la deja en "error" (se reintenta en el siguiente tick).
  it("un 429 persistente (dos fallos seguidos) lanza en vez de devolver [], y no cachea nada", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson({ error: "demasiadas peticiones" }, 429));
    const cache = cacheSitiosMemoria();
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    await expect(fuente.buscarNominatim("Museo del Prado", "Madrid", bbox)).rejects.toThrow(
      "no se pudo buscar «Museo del Prado, Madrid»",
    );

    expect(fetchFalso).toHaveBeenCalledTimes(2);

    // Nada cacheado: un segundo intento vuelve a pedir red, no da por buena
    // una respuesta negativa que nunca llegó a darse.
    fetchFalso.mockClear();
    fetchFalso.mockImplementation(async () => respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]));
    const resultado = await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(resultado).toHaveLength(1);
  });
});

// ciu-ac2/ciu-ac7: las dos operaciones nuevas comparten User-Agent, ritmo
// y caché con el resto de fuenteAbierta, pero distinguen "sin resultado"
// (negativo legítimo, se cachea) de "no se pudo preguntar" (FalloRedCiudad,
// nunca se cachea).
describe("crearFuenteAbierta -- buscarLibre y geocodificarCiudad (ciu-ac2, ciu-ac7)", () => {
  it("buscarLibre manda el User-Agent honesto y respeta el ritmo con buscarNominatim", async () => {
    const reloj = crearRelojFalso();
    const peticiones: { headers: Record<string, string> }[] = [];
    const fetchFalso = vi.fn(async (_url: string, init?: RequestInit) => {
      peticiones.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]);
    });
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    await fuente.buscarLibre("British Museum");
    await fuente.buscarLibre("London Eye");

    expect(peticiones).toHaveLength(2);
    expect(peticiones[0].headers["user-agent"]).toMatch(/^viajes-planner\//);
    expect(reloj.esperas.filter((ms) => ms >= 1100)).toHaveLength(1);
  });

  it("buscarLibre cachea un resultado negativo, sin petición nueva en la repetición", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson([]));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    const primera = await fuente.buscarLibre("Sitio Inexistente");
    const segunda = await fuente.buscarLibre("sitio inexistente");

    expect(primera).toEqual([]);
    expect(segunda).toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("buscarLibre lanza FalloRedCiudad (sin cachear) cuando la petición falla tras el reintento", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson({ error: "demasiadas peticiones" }, 429));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    await expect(fuente.buscarLibre("British Museum")).rejects.toThrow("no se pudo buscar libremente");
    expect(fetchFalso).toHaveBeenCalledTimes(2);

    // Sin caché del fallo: una segunda llamada vuelve a intentarlo de verdad.
    const fetchSegunda = vi.fn(async () => respuestaJson({ error: "demasiadas peticiones" }, 429));
    const fuente2 = crearFuenteAbierta({ fetch: fetchSegunda as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    await expect(fuente2.buscarLibre("British Museum")).rejects.toThrow();
  });

  it("geocodificarCiudad devuelve la caja de la ciudad y cachea el resultado", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () =>
      respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["51.28", "51.69", "-0.51", "0.33"] }]),
    );
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    const caja = await fuente.geocodificarCiudad("Greater London");
    const cajaOtraVez = await fuente.geocodificarCiudad("greater LONDON");

    expect(caja).toEqual({ minLat: 51.28, maxLat: 51.69, minLon: -0.51, maxLon: 0.33 });
    expect(cajaOtraVez).toEqual(caja);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("geocodificarCiudad cachea un 'no encontrada' (null) legítimo sin reintentar", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson([]));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    const primera = await fuente.geocodificarCiudad("Ciudad Inventada");
    const segunda = await fuente.geocodificarCiudad("Ciudad Inventada");

    expect(primera).toBeNull();
    expect(segunda).toBeNull();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("geocodificarCiudad lanza FalloRedCiudad cuando la petición falla tras el reintento", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson({ error: "error de servidor" }, 503));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    await expect(fuente.geocodificarCiudad("Greater London")).rejects.toThrow("no se pudo geocodificar la ciudad candidata");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  // ciu-ac3: el cualificador geográfico y las claves de caché usan la
  // ciudad efectiva, nunca el texto del destino -- aquí se comprueba que
  // buscarLibre/geocodificarCiudad ni siquiera reciben un destino como
  // argumento (a diferencia de buscarNominatim), así que no hay manera de
  // que una clave de estas dos funciones contenga el destino en bruto.
  it("buscarLibre y geocodificarCiudad no aceptan destino: su clave de caché depende solo del nombre consultado", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson([{ ...CANDIDATO_NOMINATIM, boundingbox: ["40", "41", "-4", "-3"] }]));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });

    expect(fuente.buscarLibre.length).toBe(1);
    expect(fuente.geocodificarCiudad.length).toBe(1);
  });
});

// dif-ac1: el horario de OSM guarda cuándo se comprobó, y solo si parece una fecha.
describe("fecha de comprobación del horario (dif-ac1)", () => {
  async function candidatoCon(extratags: Record<string, string>) {
    const fetchFalso = vi.fn(async () => respuestaJson([{ ...CANDIDATO_NOMINATIM, extratags, boundingbox: ["40", "41", "-4", "-3"] }]));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj: crearRelojFalso(), cache: cacheSitiosMemoria() });
    const [candidato] = await fuente.buscarNominatim("Museo del Prado", "Madrid", { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 });
    return candidato.etiquetas;
  }

  it("prefiere check_date:opening_hours a check_date", async () => {
    const etiquetas = await candidatoCon({ opening_hours: "Mo-Su 10:00-18:00", "check_date:opening_hours": "2023-05-02", check_date: "2025-01-01" });
    expect(etiquetas.check_date_opening_hours).toBe("2023-05-02");
  });

  it("usa check_date si no hay otra", async () => {
    expect((await candidatoCon({ check_date: "2022-11" })).check_date_opening_hours).toBe("2022-11");
  });

  it("descarta un valor que no es una fecha ISO", async () => {
    expect((await candidatoCon({ "check_date:opening_hours": "<script>alert(1)</script>" })).check_date_opening_hours).toBeUndefined();
    expect((await candidatoCon({})).check_date_opening_hours).toBeUndefined();
  });
});
