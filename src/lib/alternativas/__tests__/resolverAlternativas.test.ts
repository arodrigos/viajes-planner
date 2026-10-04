import { describe, expect, it } from "vitest";
import { resolverAlternativasPlan } from "../resolverAlternativas";
import type { FuenteCercanos } from "../cercanos";
import type { CajaDelimitadora, CandidatoLugar, FuenteLugares } from "@/lib/lugares/tipos";
import type { Plan } from "@/lib/plan/tipos";

const BBOX: CajaDelimitadora = { minLat: 40, maxLat: 41, minLon: -4, maxLon: -3 };

function fuenteLugares(nominatim: Record<string, CandidatoLugar[]>): FuenteLugares {
  return {
    async geocodificarDestino() {
      return BBOX;
    },
    async buscarNominatim(nombre) {
      return nominatim[nombre] ?? [];
    },
    async buscarWikipedia() {
      return [];
    },
  };
}

function candidato(nombre: string, lat: number, lon: number, categoriaOsm: string): CandidatoLugar {
  return {
    fuente: "osm",
    id: `osm:node/${nombre}`,
    url: `https://www.openstreetmap.org/node/${nombre}`,
    nombreFuente: nombre,
    nombresAlternativos: [],
    lat,
    lon,
    categoriaOsm,
    etiquetas: {},
  };
}

function planConUnaParada(
  categoria: "museo",
  coordenadas: { lat: number; lon: number } | undefined,
  alternativas: Array<{ nombre: string; descripcion: string; motivo: string; duracion_min: number }>,
): Plan {
  return {
    id: "plan-alt-test",
    version: 1,
    destino: "Madrid",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-1",
            franja_id: "manana",
            nombre: "Museo del Prado",
            descripcion: "d",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "propuesto-sin-verificar" },
            categoria,
            coordenadas,
            alternativas,
          },
        ],
      },
    ],
  };
}

describe("resolverAlternativasPlan (alt-ac3/alt-ac4)", () => {
  it("guarda las alternativas del modelo que resuelven y son equivalentes", async () => {
    const lugares = fuenteLugares({ "Museo Thyssen": [candidato("Museo Thyssen", 40.5, -3.5, "tourism")] });
    const sinCercanos: FuenteCercanos = { async buscar() { return []; } };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, [
      { nombre: "Museo Thyssen", descripcion: "d", motivo: "mismo tipo", duracion_min: 90 },
    ]);

    const resultado = await resolverAlternativasPlan(lugares, sinCercanos, plan, "familiar");

    const alternativas = resultado.dias[0].paradas[0].alternativas;
    expect(alternativas).toHaveLength(1);
    expect(alternativas?.[0]).toMatchObject({ nombre: "Museo Thyssen", origen: "modelo", categoria: "museo" });
  });

  it("descarta una alternativa del modelo que no resuelve a nada (sin candidato aceptable)", async () => {
    const lugares = fuenteLugares({});
    const sinCercanos: FuenteCercanos = { async buscar() { return []; } };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, [
      { nombre: "Sitio inventado", descripcion: "d", motivo: "m", duracion_min: 90 },
    ]);

    const resultado = await resolverAlternativasPlan(lugares, sinCercanos, plan, "familiar");

    expect(resultado.dias[0].paradas[0].alternativas).toBeUndefined();
  });

  it("completa con Overpass cuando quedan menos de 2 alternativas del modelo", async () => {
    const lugares = fuenteLugares({});
    const conCercanos: FuenteCercanos = {
      async buscar() {
        return [
          { id: "osm:node/1", nombre: "Museo Cercano A", lat: 40.501, lon: -3.501 },
          { id: "osm:node/2", nombre: "Museo Cercano B", lat: 40.502, lon: -3.502 },
        ];
      },
    };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, []);

    const resultado = await resolverAlternativasPlan(lugares, conCercanos, plan, "familiar");

    const alternativas = resultado.dias[0].paradas[0].alternativas;
    expect(alternativas).toHaveLength(2);
    expect(alternativas?.every((a) => a.origen === "cercano")).toBe(true);
    expect(alternativas?.[0].motivo).toMatch(/^A \d+ m, misma categoría \(tourism=museum\) según OpenStreetMap\.$/);
  });

  it("no completa con Overpass si ya hay 2 o más alternativas del modelo", async () => {
    const lugares = fuenteLugares({
      "Museo A": [candidato("Museo A", 40.501, -3.501, "tourism")],
      "Museo B": [candidato("Museo B", 40.502, -3.502, "tourism")],
    });
    let llamadasCercanos = 0;
    const conCercanos: FuenteCercanos = {
      async buscar() {
        llamadasCercanos += 1;
        return [{ id: "osm:node/3", nombre: "No debería aparecer", lat: 40.503, lon: -3.503 }];
      },
    };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, [
      { nombre: "Museo A", descripcion: "d", motivo: "m", duracion_min: 90 },
      { nombre: "Museo B", descripcion: "d", motivo: "m", duracion_min: 90 },
    ]);

    const resultado = await resolverAlternativasPlan(lugares, conCercanos, plan, "familiar");

    expect(llamadasCercanos).toBe(0);
    expect(resultado.dias[0].paradas[0].alternativas).toHaveLength(2);
  });

  it("descarta de Overpass el candidato cuyo id OSM es el de la propia parada, aunque el nombre no coincida (alt-ac4, hallazgo gatekeeper: 'Mercado Central de Valencia' -> 'Mercat Central')", async () => {
    const lugares = fuenteLugares({});
    const conCercanos: FuenteCercanos = {
      async buscar() {
        return [
          { id: "osm:node/mismo-sitio", nombre: "Mercat Central", lat: 40.5001, lon: -3.5001 },
          { id: "osm:node/2", nombre: "Museo Cercano B", lat: 40.502, lon: -3.502 },
        ];
      },
    };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, []);
    plan.dias[0].paradas[0].lugar = {
      fuente: "osm",
      id: "osm:node/mismo-sitio",
      url: "https://www.openstreetmap.org/node/mismo-sitio",
      nombre_fuente: "Mercat Central",
      etiquetas: {},
      resuelto_en: "2026-10-04T00:00:00Z",
    };

    const resultado = await resolverAlternativasPlan(lugares, conCercanos, plan, "familiar");

    const alternativas = resultado.dias[0].paradas[0].alternativas;
    expect(alternativas).toHaveLength(1);
    expect(alternativas?.[0].nombre).toBe("Museo Cercano B");
  });

  it("descarta de Overpass un candidato que ya es OTRA parada del mismo plan", async () => {
    const lugares = fuenteLugares({});
    const conCercanos: FuenteCercanos = {
      async buscar() {
        return [
          { id: "osm:node/jardin-del-turia", nombre: "Jardín del Turia", lat: 40.501, lon: -3.501 },
          { id: "osm:node/2", nombre: "Museo Cercano B", lat: 40.502, lon: -3.502 },
        ];
      },
    };
    const plan = planConUnaParada("museo", { lat: 40.5, lon: -3.5 }, []);
    plan.dias[0].paradas.push({
      id: "parada-2",
      franja_id: "manana",
      nombre: "Jardín del Turia",
      descripcion: "d",
      duracion_min: 60,
      prioridad: 70,
      procedencia: { fuente: "propuesto-sin-verificar" },
      categoria: "parque",
    });

    const resultado = await resolverAlternativasPlan(lugares, conCercanos, plan, "familiar");

    const alternativas = resultado.dias[0].paradas[0].alternativas;
    expect(alternativas).toHaveLength(1);
    expect(alternativas?.[0].nombre).toBe("Museo Cercano B");
  });

  it("una parada sin categoria no guarda alternativas", async () => {
    const lugares = fuenteLugares({});
    const sinCercanos: FuenteCercanos = { async buscar() { return []; } };
    const plan = planConUnaParada(undefined as unknown as "museo", { lat: 40.5, lon: -3.5 }, [
      { nombre: "x", descripcion: "d", motivo: "m", duracion_min: 90 },
    ]);

    const resultado = await resolverAlternativasPlan(lugares, sinCercanos, plan, "familiar");

    expect(resultado.dias[0].paradas[0].alternativas).toBeUndefined();
  });
});
