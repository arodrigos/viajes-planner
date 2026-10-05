import { describe, expect, it, vi } from "vitest";
import { construirConsultaOverpass, crearFuenteCercanosAbierta, FalloFuenteCercanos } from "../cercanos";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { Reloj } from "@/lib/lugares/limitador";

const RELOJ_FALSO: Reloj = { ahora: () => 0, dormir: vi.fn().mockResolvedValue(undefined) };

function respuestaFetch(cuerpo: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as Response;
}

describe("construirConsultaOverpass (alt-ac4)", () => {
  it("genera exactamente la plantilla esperada para categoria='museo'", () => {
    const consulta = construirConsultaOverpass("museo", 40.4138, -3.6921);
    expect(consulta).toBe("[out:json];\nnwr[tourism=museum](around:1500,40.4138,-3.6921);\nout center tags 5;");
  });

  it("no contiene nunca el nombre de una parada, aunque tenga sintaxis de Overpass QL", () => {
    const consulta = construirConsultaOverpass("museo", 40.4138, -3.6921);
    expect(consulta).not.toContain('"x"];out;//');
  });

  it("devuelve null para 'otro' (sin etiqueta OSM en la tabla cerrada)", () => {
    expect(construirConsultaOverpass("otro", 40.4138, -3.6921)).toBeNull();
  });
});

describe("crearFuenteCercanosAbierta (alt-ac4)", () => {
  it("cachea por (categoria, lat/lon a 3 decimales, radio): una segunda llamada con las mismas coordenadas no hace una segunda petición", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFetch({ elements: [{ type: "node", id: 1, lat: 40.41, lon: -3.69, tags: { name: "Museo Cercano" } }] }));
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: RELOJ_FALSO, cache: cacheSitiosMemoria() });

    await fuente.buscar("museo", 40.41381234, -3.69211234);
    await fuente.buscar("museo", 40.41389999, -3.69219999);

    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("envía el User-Agent de la aplicación en cada petición", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFetch({ elements: [] }));
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: RELOJ_FALSO, cache: cacheSitiosMemoria() });

    await fuente.buscar("museo", 10, 10);

    const opciones = fetchFalso.mock.calls[0][1] as RequestInit;
    expect((opciones.headers as Record<string, string>)["User-Agent"]).toContain("viajes-planner/");
  });

  it("ante 429 espera 30.000 ms y reintenta una vez", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuestaFetch(null, 429))
      .mockResolvedValueOnce(respuestaFetch({ elements: [] }));
    const dormir = vi.fn().mockResolvedValue(undefined);
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: { ahora: () => 0, dormir }, cache: cacheSitiosMemoria() });

    await fuente.buscar("museo", 10, 10);

    expect(dormir).toHaveBeenCalledWith(30_000);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("devuelve hasta 5 resultados con nombre, lat y lon a partir de la respuesta de Overpass", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      respuestaFetch({
        elements: [
          { type: "node", id: 1, lat: 40.1, lon: -3.1, tags: { name: "Museo A" } },
          { type: "way", id: 2, center: { lat: 40.2, lon: -3.2 }, tags: { name: "Museo B" } },
          { type: "node", id: 3, lat: 40.3, lon: -3.3 },
        ],
      }),
    );
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: RELOJ_FALSO, cache: cacheSitiosMemoria() });

    const resultado = await fuente.buscar("museo", 10, 10);

    expect(resultado).toEqual([
      { id: "osm:node/1", nombre: "Museo A", lat: 40.1, lon: -3.1 },
      { id: "osm:way/2", nombre: "Museo B", lat: 40.2, lon: -3.2 },
    ]);
  });

  it("un 503 persistente lanza FalloFuenteCercanos y no se cachea como «sin cercanos»", async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuestaFetch(null, 503))
      .mockResolvedValueOnce(respuestaFetch(null, 503))
      .mockResolvedValue(respuestaFetch({ elements: [{ type: "node", id: 1, lat: 40.41, lon: -3.69, tags: { name: "Museo Cercano" } }] }));
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: RELOJ_FALSO, cache: cacheSitiosMemoria() });

    await expect(fuente.buscar("museo", 40.41, -3.69)).rejects.toBeInstanceOf(FalloFuenteCercanos);
    // La siguiente llamada vuelve a preguntar y ya obtiene el resultado real.
    const cercanos = await fuente.buscar("museo", 40.41, -3.69);
    expect(cercanos.map((c) => c.nombre)).toEqual(["Museo Cercano"]);
  });

  it("un error de red lanza FalloFuenteCercanos y no se cachea", async () => {
    const fetchFalso = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValue(respuestaFetch({ elements: [] }));
    const fuente = crearFuenteCercanosAbierta({ fetch: fetchFalso, reloj: RELOJ_FALSO, cache: cacheSitiosMemoria() });

    await expect(fuente.buscar("museo", 10, 10)).rejects.toBeInstanceOf(FalloFuenteCercanos);
    await expect(fuente.buscar("museo", 10, 10)).resolves.toEqual([]);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
});
