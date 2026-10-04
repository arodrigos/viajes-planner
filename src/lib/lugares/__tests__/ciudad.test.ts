import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolverCiudadEfectiva } from "../ciudad";
import { crearFuenteLugaresGrabada, type FixturesFuenteGrabada } from "../fuenteGrabada";
import type { CajaDelimitadora, CandidatoLugar } from "../tipos";

function candidato(parcial: Partial<CandidatoLugar> & Pick<CandidatoLugar, "nombreFuente" | "lat" | "lon">): CandidatoLugar {
  return { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombresAlternativos: [], etiquetas: {}, ...parcial };
}

function contador() {
  let destino = 0;
  let nominatim = 0;
  let libres = 0;
  let ciudades = 0;
  return {
    envolver(fuente: ReturnType<typeof crearFuenteLugaresGrabada>) {
      return {
        async geocodificarDestino(d: string): ReturnType<typeof fuente.geocodificarDestino> {
          destino++;
          return fuente.geocodificarDestino(d);
        },
        async buscarNominatim(...args: Parameters<typeof fuente.buscarNominatim>): ReturnType<typeof fuente.buscarNominatim> {
          nominatim++;
          return fuente.buscarNominatim(...args);
        },
        async buscarWikipedia(...args: Parameters<typeof fuente.buscarWikipedia>): ReturnType<typeof fuente.buscarWikipedia> {
          return fuente.buscarWikipedia(...args);
        },
        async buscarLibre(...args: Parameters<typeof fuente.buscarLibre>): ReturnType<typeof fuente.buscarLibre> {
          libres++;
          return fuente.buscarLibre(...args);
        },
        async geocodificarCiudad(...args: Parameters<typeof fuente.geocodificarCiudad>): ReturnType<typeof fuente.geocodificarCiudad> {
          ciudades++;
          return fuente.geocodificarCiudad(...args);
        },
      };
    },
    conteos: () => ({ destino, nominatim, libres, ciudades }),
  };
}

const BBOX_SEVILLA: CajaDelimitadora = { minLat: 37.3, maxLat: 37.45, minLon: -6.05, maxLon: -5.9 };
const PARADAS_SEVILLA = ["Real Alcázar", "Catedral de Sevilla", "Plaza de España", "Metropol Parasol", "Barrio de Santa Cruz"];

function fixturesSevillaResuelve(): FixturesFuenteGrabada {
  const destino = "Sevilla";
  const nominatim: Record<string, CandidatoLugar[]> = {};
  for (const nombre of PARADAS_SEVILLA) {
    nominatim[`${nombre}::${destino}`] = [candidato({ nombreFuente: nombre, lat: 37.38, lon: -5.99 })];
  }
  return { destinos: { [destino]: BBOX_SEVILLA }, nominatim };
}

describe("resolverCiudadEfectiva -- destino (ciu-ac1)", () => {
  // cp-ciu-01
  it("acepta la caja del destino cuando >= 2 de la muestra de 5 resuelven, sin peticiones extra", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesSevillaResuelve()));
    const resultado = await resolverCiudadEfectiva(fuente, destino, PARADAS_SEVILLA);
    expect(resultado?.estado).toBe("resuelta");
    expect(resultado?.metodo).toBe("destino");
    expect(resultado?.nombre).toBe("Sevilla");
    expect(resultado?.apoyo).toBeUndefined();
    const conteos = c.conteos();
    expect(conteos.destino).toBe(1);
    expect(conteos.nominatim).toBe(5);
    expect(conteos.libres).toBe(0);
    expect(conteos.ciudades).toBe(0);
  });

  const destino = "Sevilla";

  it("un plan con solo 3 paradas usa una muestra de 3 y exige >= 2 aceptadas", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesSevillaResuelve()));
    const resultado = await resolverCiudadEfectiva(fuente, destino, PARADAS_SEVILLA.slice(0, 3));
    expect(resultado?.estado).toBe("resuelta");
    expect(resultado?.metodo).toBe("destino");
    expect(c.conteos().nominatim).toBe(3);
  });

  // cp-ciu-02
  it("descarta la caja del destino con motivo exacto cuando 0 de 5 resuelven, y sigue a la deducción", async () => {
    const fuente = crearFuenteLugaresGrabada({
      destinos: { "Ciudad con niños": { minLat: 10, maxLat: 10.1, minLon: 10, maxLon: 10.1 } },
      nominatim: {},
      libres: {},
    });
    const paradas = ["Parque infantil", "Zoo", "Museo de los niños", "Acuario", "Plaza mayor"];
    const resultado = await resolverCiudadEfectiva(fuente, "Ciudad con niños", paradas);
    expect(resultado?.metodo).not.toBe("destino");
    expect(resultado?.motivo_destino_descartado).toBe("la caja del destino no resolvió ninguna parada (0 de 5)");
  });

  // cp-ciu-03
  it("si el destino no geocodifica, salta la muestra y va directa a deducción", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada({ destinos: {}, nominatim: {}, libres: {} }));
    const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", ["a", "b", "c"]);
    expect(resultado?.motivo_destino_descartado).toBeUndefined();
    expect(c.conteos().nominatim).toBe(0);
    expect(c.conteos().destino).toBe(1);
  });

  it("menos de 3 paradas distintas: sin-ciudad-identificable sin ninguna búsqueda libre", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada({ destinos: {}, nominatim: {}, libres: {} }));
    const resultado = await resolverCiudadEfectiva(fuente, "Ciudad con niños", ["Parque infantil", "Zoo"]);
    expect(resultado?.estado).toBe("sin-ciudad-identificable");
    expect(resultado?.motivo).toBe("no hay suficientes paradas para deducir la ciudad (2)");
    expect(c.conteos().libres).toBe(0);
  });
});

function direccionLondres(city: string): CandidatoLugar["direccion"] {
  return { city, state_district: "Greater London" };
}

describe("resolverCiudadEfectiva -- deducción por paradas (ciu-ac2)", () => {
  const PARADAS_LONDRES = [
    "British Museum",
    "London Eye",
    "Tower of London",
    "Hyde Park",
    "Natural History Museum",
    "Camden Market",
    "Greenwich Park",
    "Science Museum",
  ];

  function fixturesLondres(): FixturesFuenteGrabada {
    const libres: Record<string, CandidatoLugar[]> = {};
    const ciudades = ["London", "London", "London", "City of Westminster", "City of Westminster", "City of Westminster", "Camden", "Greenwich"];
    PARADAS_LONDRES.forEach((nombre, indice) => {
      libres[nombre] = [candidato({ nombreFuente: nombre, lat: 51.5 + indice * 0.01, lon: -0.1, direccion: direccionLondres(ciudades[indice]) })];
    });
    return {
      destinos: {},
      nominatim: {},
      libres,
      ciudades: { "Greater London": { minLat: 51.28, maxLat: 51.69, minLon: -0.51, maxLon: 0.33 } },
    };
  }

  // cp-ciu-04
  it("cuando ningún borough gana con ventaja 2, sube al distrito y resuelve con apoyo total", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesLondres()));
    const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", PARADAS_LONDRES);
    expect(resultado?.estado).toBe("resuelta");
    expect(resultado?.metodo).toBe("paradas");
    expect(resultado?.nivel).toBe("distrito");
    expect(resultado?.nombre).toBe("Greater London");
    expect(resultado?.apoyo).toBeGreaterThanOrEqual(6);
    const caja = resultado!.caja!;
    expect(caja.maxLat - caja.minLat).toBeLessThanOrEqual(2);
    expect(caja.maxLon - caja.minLon).toBeLessThanOrEqual(2);
    const conteos = c.conteos();
    expect(conteos.libres).toBeLessThanOrEqual(8);
    expect(conteos.ciudades).toBe(1);
  });

  it("no consulta una novena parada aunque el plan tenga 24", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesLondres()));
    const extra = Array.from({ length: 16 }, (_, i) => `Sitio inventado ${i}`);
    await resolverCiudadEfectiva(fuente, "Londres en familia con niños", [...PARADAS_LONDRES, ...extra]);
    expect(c.conteos().libres).toBeLessThanOrEqual(8);
  });

  // cp-ciu-05
  it("sin-ciudad-identificable cuando 6 ciudades distintas reparten el apoyo sin ganador", async () => {
    const nombres = ["Parque infantil", "Zoo", "Museo de los niños", "Acuario", "Plaza mayor", "Mercado", "Playa", "Parque de atracciones"];
    const ciudadesPorParada = ["Madrid", "Madrid", "Valencia", "Valencia", "Barcelona", "Sevilla", "Bilbao", "Malaga"];
    const libres: Record<string, CandidatoLugar[]> = {};
    nombres.forEach((nombre, indice) => {
      libres[nombre] = [candidato({ nombreFuente: nombre, lat: 40 + indice, lon: -3 + indice, direccion: { city: ciudadesPorParada[indice] } })];
    });
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada({ destinos: {}, nominatim: {}, libres, ciudades: {} }));
    const resultado = await resolverCiudadEfectiva(fuente, "Ciudad con niños", nombres);
    expect(resultado?.estado).toBe("sin-ciudad-identificable");
    expect(resultado?.motivo).toContain("no hay una ciudad clara");
    expect(resultado?.candidatos?.length).toBe(3);
    expect(c.conteos().ciudades).toBe(0);
  });

  it("rechaza un ganador cuya caja abarca más de 2 grados", async () => {
    const nombres = ["Sitio A", "Sitio B", "Sitio C", "Sitio D"];
    const libres: Record<string, CandidatoLugar[]> = {};
    nombres.forEach((nombre, indice) => {
      libres[nombre] = [candidato({ nombreFuente: nombre, lat: 37 + indice * 0.3, lon: -5, direccion: { city: "Sevilla", state: "Andalucía" } })];
    });
    const c = contador();
    const fuente = c.envolver(
      crearFuenteLugaresGrabada({
        destinos: {},
        nominatim: {},
        libres,
        ciudades: { Sevilla: { minLat: 30, maxLat: 35, minLon: -8, maxLon: -3 } },
      }),
    );
    const resultado = await resolverCiudadEfectiva(fuente, "Andalucía con niños", nombres);
    expect(resultado?.estado).toBe("sin-ciudad-identificable");
    expect(resultado?.motivo).toContain("abarca una zona demasiado grande");
  });
});

describe("resolverCiudadEfectiva -- red (ciu-ac7)", () => {
  it("un fallo de red persistente deja el resultado inconcluso (null), no 'sin-ciudad-identificable'", async () => {
    const fuente = crearFuenteLugaresGrabada({
      destinos: {},
      nominatim: {},
      libres: {},
      fallosLibres: new Set(["British Museum", "London Eye", "Tower of London"]),
    });
    const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", ["British Museum", "London Eye", "Tower of London"]);
    expect(resultado).toBeNull();
  });
});

describe("resolverCiudadEfectiva -- invariante de orden", () => {
  it("permutar la lista de paradas nunca cambia el resultado", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(
          [
            "British Museum",
            "London Eye",
            "Tower of London",
            "Hyde Park",
            "Natural History Museum",
            "Camden Market",
            "Greenwich Park",
            "Science Museum",
          ],
          { minLength: 8 },
        ),
        async (orden) => {
          const libres: Record<string, CandidatoLugar[]> = {};
          const ciudadesPorNombre: Record<string, string> = {
            "British Museum": "London",
            "London Eye": "London",
            "Tower of London": "London",
            "Hyde Park": "City of Westminster",
            "Natural History Museum": "City of Westminster",
            "Camden Market": "City of Westminster",
            "Greenwich Park": "Camden",
            "Science Museum": "Greenwich",
          };
          for (const nombre of orden) {
            libres[nombre] = [candidato({ nombreFuente: nombre, lat: 51.5, lon: -0.1, direccion: direccionLondres(ciudadesPorNombre[nombre]) })];
          }
          const fuente = crearFuenteLugaresGrabada({
            destinos: {},
            nominatim: {},
            libres,
            ciudades: { "Greater London": { minLat: 51.28, maxLat: 51.69, minLon: -0.51, maxLon: 0.33 } },
          });
          const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", orden);
          expect(resultado?.estado).toBe("resuelta");
          expect(resultado?.nombre).toBe("Greater London");
          expect(resultado?.apoyo).toBe(8);
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("resolverCiudadEfectiva -- invariante de tope de peticiones", () => {
  it("nunca hace más de min(8, nombres distintos) búsquedas libres", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0), { minLength: 0, maxLength: 30 }), async (nombres) => {
        const c = contador();
        const fuente = c.envolver(crearFuenteLugaresGrabada({ destinos: {}, nominatim: {}, libres: {}, ciudades: {} }));
        await resolverCiudadEfectiva(fuente, "Un destino que no geocodifica", nombres);
        expect(c.conteos().libres).toBeLessThanOrEqual(8);
      }),
      { numRuns: 25 },
    );
  });
});
