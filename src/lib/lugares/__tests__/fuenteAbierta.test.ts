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

  it("un 429 persistente (dos fallos seguidos) deja la búsqueda sin candidatos, sin un tercer intento", async () => {
    const reloj = crearRelojFalso();
    const fetchFalso = vi.fn(async () => respuestaJson({ error: "demasiadas peticiones" }, 429));
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    const bbox = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

    const resultado = await fuente.buscarNominatim("Museo del Prado", "Madrid", bbox);

    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(resultado).toEqual([]);
  });
});
