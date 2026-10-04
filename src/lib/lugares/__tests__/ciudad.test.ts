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

// Fixtures grabadas de verdad contra la API real de Nominatim el
// 2026-10-04 (format=jsonv2&limit=3&addressdetails=1&accept-language=es),
// SIN viewbox -- exactamente la llamada que hace buscarLibre. Sustituyen a
// las fixtures con `state_district: "Greater London"` del run anterior,
// que el gatekeeper comprobó que la API real no devuelve para Londres: la
// API real da `city` ("Gran Londres" o "City of Westminster") y, cuando
// hay distrito, `city_district`/`borough`/`suburb`, nunca state_district
// ni county para esta ciudad.
function direccionLondres(parcial: Pick<NonNullable<CandidatoLugar["direccion"]>, "city"> & Partial<CandidatoLugar["direccion"]>): CandidatoLugar["direccion"] {
  return { state: "Inglaterra", ...parcial };
}

describe("resolverCiudadEfectiva -- deducción por paradas (ciu-ac2)", () => {
  // Las 7 paradas y sus direcciones reales grabadas el 2026-10-04. 4 caen
  // bajo address.city="Gran Londres" y 3 bajo address.city="City of
  // Westminster" -- la ventaja entre ambas es solo 1, por debajo de
  // VENTAJA_MINIMA, exactamente el escrutinio que el gatekeeper midió
  // contra la API real con el destino «Londres en familia con niños».
  const PARADAS_LONDRES_REALES: Array<{ nombre: string; lat: number; lon: number; direccion: CandidatoLugar["direccion"] }> = [
    { nombre: "British Museum", lat: 51.5193118, lon: -0.1267051, direccion: direccionLondres({ city: "Gran Londres", city_district: "Camden", suburb: "Bloomsbury" }) },
    { nombre: "London Eye", lat: 51.5028274, lon: -0.1174123, direccion: direccionLondres({ city: "Gran Londres", city_district: "London Borough of Lambeth", suburb: "Waterloo" }) },
    { nombre: "Tower of London", lat: 51.508217, lon: -0.0761879, direccion: direccionLondres({ city: "Gran Londres", borough: "London Borough of Tower Hamlets", suburb: "Whitechapel" }) },
    { nombre: "Natural History Museum", lat: 51.4965109, lon: -0.1760019, direccion: direccionLondres({ city: "Gran Londres", city_district: "Kensington y Chelsea", suburb: "Brompton" }) },
    { nombre: "Hyde Park", lat: 51.5074889, lon: -0.1622074, direccion: direccionLondres({ city: "City of Westminster", suburb: "Mayfair" }) },
    { nombre: "Buckingham Palace", lat: 51.5008349, lon: -0.1430045, direccion: direccionLondres({ city: "City of Westminster", suburb: "Victoria" }) },
    { nombre: "Westminster Abbey", lat: 51.499399, lon: -0.127391, direccion: direccionLondres({ city: "City of Westminster", suburb: "Millbank" }) },
  ];
  const PARADAS_LONDRES = PARADAS_LONDRES_REALES.map((p) => p.nombre);
  // Caja real de "Gran Londres" (geocodificarCiudad con featureType=settlement),
  // grabada el 2026-10-04: span 0,405 x 0,844 grados, contiene las coordenadas
  // de las 7 paradas de arriba (incluidas las 3 de "City of Westminster").
  const CAJA_GRAN_LONDRES = { minLat: 51.2867601, maxLat: 51.6918741, minLon: -0.5103751, maxLon: 0.3340155 };

  function fixturesLondres(): FixturesFuenteGrabada {
    const libres: Record<string, CandidatoLugar[]> = {};
    for (const p of PARADAS_LONDRES_REALES) {
      libres[p.nombre] = [candidato({ nombreFuente: p.nombre, lat: p.lat, lon: p.lon, direccion: p.direccion })];
    }
    return {
      destinos: {},
      nominatim: {},
      libres,
      ciudades: { "Gran Londres": CAJA_GRAN_LONDRES },
    };
  }

  // cp-ciu-04: con datos reales, "Gran Londres" (4 paradas) y "City of
  // Westminster" (3 paradas) empatan por debajo de la ventaja mínima en el
  // nivel "ciudad" -- el nivel "distrito" (boroughs) no da ningún ganador
  // porque cada borough tiene como mucho 1 voto. Gana "Gran Londres" por
  // CONTENCIÓN: su caja verificada contiene también las coordenadas de las
  // 3 paradas que votaron a Westminster, así que Westminster no es un
  // candidato rival, es una subdivisión suya.
  it("cuando la ciudad grande y una sub-ciudad reparten el voto sin ventaja, gana la que contiene a la otra", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesLondres()));
    const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", PARADAS_LONDRES);
    expect(resultado?.estado).toBe("resuelta");
    expect(resultado?.metodo).toBe("paradas");
    expect(resultado?.nivel).toBe("ciudad");
    expect(resultado?.nombre).toBe("Gran Londres");
    expect(resultado?.apoyo).toBeGreaterThanOrEqual(4);
    const caja = resultado!.caja!;
    expect(caja.maxLat - caja.minLat).toBeLessThanOrEqual(2);
    expect(caja.maxLon - caja.minLon).toBeLessThanOrEqual(2);
    const conteos = c.conteos();
    expect(conteos.libres).toBeLessThanOrEqual(8);
    expect(conteos.ciudades).toBe(1);
  });

  it("no consulta una octava parada aunque el plan tenga 24", async () => {
    const c = contador();
    const fuente = c.envolver(crearFuenteLugaresGrabada(fixturesLondres()));
    const extra = Array.from({ length: 17 }, (_, i) => `Sitio inventado ${i}`);
    await resolverCiudadEfectiva(fuente, "Londres en familia con niños", [...PARADAS_LONDRES, ...extra]);
    expect(c.conteos().libres).toBeLessThanOrEqual(8);
  });

  // La contención no es gratis: si la sub-ciudad minoritaria tuviera
  // coordenadas FUERA de la caja de la mayoritaria (dos lugares de verdad
  // distintos, no una ciudad y su distrito), no debe ganar sin ventaja.
  it("sin contención geográfica, el empate sin ventaja no se resuelve y cae al nivel siguiente", async () => {
    const libres: Record<string, CandidatoLugar[]> = {};
    const datos = [
      { nombre: "Sitio Madrid 1", lat: 40.4, lon: -3.7, city: "Madrid" },
      { nombre: "Sitio Madrid 2", lat: 40.42, lon: -3.69, city: "Madrid" },
      { nombre: "Sitio Madrid 3", lat: 40.41, lon: -3.71, city: "Madrid" },
      { nombre: "Sitio Valencia 1", lat: 39.47, lon: -0.38, city: "Valencia" },
      { nombre: "Sitio Valencia 2", lat: 39.46, lon: -0.37, city: "Valencia" },
    ];
    for (const d of datos) {
      libres[d.nombre] = [candidato({ nombreFuente: d.nombre, lat: d.lat, lon: d.lon, direccion: { city: d.city, state: "España" } })];
    }
    const c = contador();
    const fuente = c.envolver(
      crearFuenteLugaresGrabada({
        destinos: {},
        nominatim: {},
        libres,
        ciudades: { Madrid: { minLat: 40.3, maxLat: 40.5, minLon: -3.8, maxLon: -3.6 } },
      }),
    );
    const resultado = await resolverCiudadEfectiva(fuente, "Ciudad con niños", datos.map((d) => d.nombre));
    expect(resultado?.estado).toBe("sin-ciudad-identificable");
    expect(resultado?.nombre).not.toBe("resuelta");
    const conteos = c.conteos();
    expect(conteos.ciudades).toBe(1);
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
  // Reutiliza las 7 paradas reales grabadas arriba (4 "Gran Londres" + 3
  // "City of Westminster", resueltas por contención): el orden de consulta
  // no puede cambiar ni el escrutinio ni la decisión de contención.
  it("permutar la lista de paradas nunca cambia el resultado", async () => {
    const datosPorNombre: Record<string, { lat: number; lon: number; direccion: CandidatoLugar["direccion"] }> = {
      "British Museum": { lat: 51.5193118, lon: -0.1267051, direccion: direccionLondres({ city: "Gran Londres", city_district: "Camden", suburb: "Bloomsbury" }) },
      "London Eye": { lat: 51.5028274, lon: -0.1174123, direccion: direccionLondres({ city: "Gran Londres", city_district: "London Borough of Lambeth", suburb: "Waterloo" }) },
      "Tower of London": { lat: 51.508217, lon: -0.0761879, direccion: direccionLondres({ city: "Gran Londres", borough: "London Borough of Tower Hamlets", suburb: "Whitechapel" }) },
      "Natural History Museum": { lat: 51.4965109, lon: -0.1760019, direccion: direccionLondres({ city: "Gran Londres", city_district: "Kensington y Chelsea", suburb: "Brompton" }) },
      "Hyde Park": { lat: 51.5074889, lon: -0.1622074, direccion: direccionLondres({ city: "City of Westminster", suburb: "Mayfair" }) },
      "Buckingham Palace": { lat: 51.5008349, lon: -0.1430045, direccion: direccionLondres({ city: "City of Westminster", suburb: "Victoria" }) },
      "Westminster Abbey": { lat: 51.499399, lon: -0.127391, direccion: direccionLondres({ city: "City of Westminster", suburb: "Millbank" }) },
    };
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(Object.keys(datosPorNombre), { minLength: 7 }), async (orden) => {
        const libres: Record<string, CandidatoLugar[]> = {};
        for (const nombre of orden) {
          const d = datosPorNombre[nombre];
          libres[nombre] = [candidato({ nombreFuente: nombre, lat: d.lat, lon: d.lon, direccion: d.direccion })];
        }
        const fuente = crearFuenteLugaresGrabada({
          destinos: {},
          nominatim: {},
          libres,
          ciudades: { "Gran Londres": { minLat: 51.2867601, maxLat: 51.6918741, minLon: -0.5103751, maxLon: 0.3340155 } },
        });
        const resultado = await resolverCiudadEfectiva(fuente, "Londres en familia con niños", orden);
        expect(resultado?.estado).toBe("resuelta");
        expect(resultado?.nombre).toBe("Gran Londres");
        expect(resultado?.apoyo).toBe(4);
      }),
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
