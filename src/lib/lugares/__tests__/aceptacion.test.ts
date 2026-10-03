import { describe, expect, it } from "vitest";
import type { CajaDelimitadora, CandidatoLugar } from "../tipos";
import { categoriaCompatible, elegirMejorCandidato, evaluarCandidato } from "../aceptacion";

// Bounding boxes reales (Nominatim, 2026-10-03): geocodificar "Madrid" y
// "Valencia" con q=<destino>&format=jsonv2&limit=1.
const BBOX_MADRID: CajaDelimitadora = { minLat: 40.3119774, maxLat: 40.6437293, minLon: -3.8889539, maxLon: -3.5183264 };
const BBOX_VALENCIA: CajaDelimitadora = { minLat: 39.2784496, maxLat: 39.566609, minLon: -0.4325512, maxLon: -0.2725205 };

function candidato(parcial: Partial<CandidatoLugar> & Pick<CandidatoLugar, "nombreFuente" | "lat" | "lon">): CandidatoLugar {
  return {
    fuente: "osm",
    id: "osm:way/1",
    url: "https://www.openstreetmap.org/way/1",
    nombresAlternativos: [],
    etiquetas: {},
    ...parcial,
  };
}

describe("evaluarCandidato (lug-ac2)", () => {
  // Caso real: Museo del Prado resuelve a sí mismo dentro de Madrid.
  it("acepta el candidato real del Museo del Prado dentro del bbox de Madrid", () => {
    const resultado = evaluarCandidato(
      "Museo del Prado",
      candidato({ nombreFuente: "Museo del Prado", lat: 40.4137925, lon: -3.6920407, categoriaOsm: "tourism" }),
      BBOX_MADRID,
      "museo",
    );
    expect(resultado.aceptado).toBe(true);
  });

  // Caso real (Nominatim, 2026-10-03): el mismo museo con su nombre oficial
  // completo, variante que namedetails trae como alt_name/official_name.
  it("acepta un nombre con variantes ('Museo Nacional del Prado' vs 'Museo del Prado')", () => {
    const resultado = evaluarCandidato(
      "Museo del Prado",
      candidato({ nombreFuente: "Museo Nacional del Prado", lat: 40.4137925, lon: -3.6920407, categoriaOsm: "tourism" }),
      BBOX_MADRID,
      "museo",
    );
    expect(resultado.aceptado).toBe(true);
  });

  // Caso real: Mercado Central de Valencia, category=amenity type=marketplace.
  it("acepta el Mercado Central de Valencia con categoría 'mercado'", () => {
    const resultado = evaluarCandidato(
      "Mercado Central",
      candidato({ nombreFuente: "Mercado Central", lat: 39.4734917, lon: -0.3789053, categoriaOsm: "amenity" }),
      BBOX_VALENCIA,
      "mercado",
    );
    expect(resultado.aceptado).toBe(true);
  });

  it("rechaza un candidato fuera del bounding box del destino (Mercado Central en Zaragoza, buscando en Valencia)", () => {
    const resultado = evaluarCandidato(
      "Mercado Central",
      candidato({ nombreFuente: "Mercado Central", lat: 41.6488, lon: -0.8891, categoriaOsm: "amenity" }), // Zaragoza
      BBOX_VALENCIA,
      "mercado",
    );
    expect(resultado.aceptado).toBe(false);
    expect(resultado.motivo).toContain("bounding box");
  });

  it("rechaza un nombre sin relación (similitud insuficiente)", () => {
    const resultado = evaluarCandidato(
      "Museo del Prado",
      candidato({ nombreFuente: "Estación de Atocha", lat: 40.4063, lon: -3.6919, categoriaOsm: "railway" }),
      BBOX_MADRID,
    );
    expect(resultado.aceptado).toBe(false);
    expect(resultado.motivo).toContain("similitud");
  });

  // Ejemplo del propio criterio: museo vs highway=bus_stop, aunque el
  // nombre casara, la clase OSM no es compatible con "museo".
  it("rechaza un bus_stop con nombre de museo por categoría OSM incompatible", () => {
    const resultado = evaluarCandidato(
      "Museo del Prado",
      candidato({ nombreFuente: "Museo del Prado", lat: 40.4137925, lon: -3.6920407, categoriaOsm: "highway" }),
      BBOX_MADRID,
      "museo",
    );
    expect(resultado.aceptado).toBe(false);
    expect(resultado.motivo).toContain("incompatible");
  });

  // Caso real: catedral de Valencia es amenity=place_of_worship, compatible
  // con "monumento" (tabla incluye "tourism" pero no "amenity" -> rechaza).
  it("rechaza la catedral real (amenity=place_of_worship) para categoría 'monumento'", () => {
    const resultado = evaluarCandidato(
      "Catedral",
      candidato({ nombreFuente: "Catedral de València", lat: 39.475568, lon: -0.3751126, categoriaOsm: "amenity" }),
      BBOX_VALENCIA,
      "monumento",
    );
    expect(resultado.aceptado).toBe(false);
  });

  it("acepta la misma catedral real cuando no se pide ninguna categoría", () => {
    const resultado = evaluarCandidato(
      "Catedral",
      candidato({ nombreFuente: "Catedral de València", lat: 39.475568, lon: -0.3751126, categoriaOsm: "amenity" }),
      BBOX_VALENCIA,
    );
    expect(resultado.aceptado).toBe(true);
  });

  // Caso real: "La Catedral" es un bar en Valencia -- nombre parecido,
  // categoría incompatible con "monumento".
  it("rechaza un bar real llamado 'La Catedral' para categoría 'monumento'", () => {
    const resultado = evaluarCandidato(
      "Catedral",
      candidato({ nombreFuente: "La Catedral", lat: 39.4760501, lon: -0.3756361, categoriaOsm: "amenity" }),
      BBOX_VALENCIA,
      "monumento",
    );
    expect(resultado.aceptado).toBe(false);
    expect(resultado.motivo).toContain("incompatible");
  });

  it("categoriaCompatible es true para 'otro' con cualquier clase OSM", () => {
    expect(categoriaCompatible("otro", "highway")).toBe(true);
    expect(categoriaCompatible(undefined, "highway")).toBe(true);
  });

  it("categoriaCompatible no rechaza cuando el candidato no trae clase OSM (dato ausente, no se penaliza)", () => {
    expect(categoriaCompatible("museo", undefined)).toBe(true);
  });
});

describe("elegirMejorCandidato (lug-ac2)", () => {
  it("se queda con el primer candidato que la regla acepta, en el orden recibido", () => {
    const candidatos = [
      candidato({ nombreFuente: "Estación de Atocha", lat: 40.4063, lon: -3.6919, categoriaOsm: "railway" }),
      candidato({ nombreFuente: "Museo del Prado", lat: 40.4137925, lon: -3.6920407, categoriaOsm: "tourism" }),
    ];
    const resultado = elegirMejorCandidato("Museo del Prado", candidatos, BBOX_MADRID, "museo");
    expect(resultado.candidato?.nombreFuente).toBe("Museo del Prado");
  });

  it("devuelve null con motivo cuando ningún candidato encaja", () => {
    const resultado = elegirMejorCandidato(
      "Museo del Prado",
      [candidato({ nombreFuente: "Estación de Atocha", lat: 40.4063, lon: -3.6919, categoriaOsm: "railway" })],
      BBOX_MADRID,
      "museo",
    );
    expect(resultado.candidato).toBeNull();
    expect(resultado.motivo).toBeTruthy();
  });
});
