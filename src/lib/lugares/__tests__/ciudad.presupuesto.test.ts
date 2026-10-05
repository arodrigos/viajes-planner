import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cacheSitiosMemoria } from "../cacheSitios";
import { PETICIONES_MAXIMAS_POR_PLAN, resolverCiudadEfectiva } from "../ciudad";
import { crearFuenteAbierta } from "../fuenteAbierta";
import type { Reloj } from "../limitador";
import { crearPresupuestoPeticiones } from "../tipos";

// Nominatim falso pero con la forma real de la API: lo único que cambia
// entre escenarios es qué contesta a cada tipo de petición. Así lo que se
// mide es lo que de verdad sale por fetch, no llamadas a métodos de un doble.
interface Escenario {
  // texto -> caja de asentamiento (featureType=settlement)
  asentamientos: Record<string, [string, string, string, string]>;
  // nombre de parada (sin cualificador) -> ciudad de la dirección, para la
  // búsqueda libre y para la acotada por viewbox
  ciudadDeParada: (nombre: string) => string | null;
  cajaDeCiudad: [string, string, string, string];
}

interface PeticionRegistrada {
  url: URL;
  inicio: number;
  fin: number;
}

function crearRelojFalso(): Reloj & { tiempo: number } {
  const estado = {
    tiempo: 0,
    ahora: () => estado.tiempo,
    dormir: async (ms: number) => {
      estado.tiempo += ms;
    },
  };
  return estado;
}

function entradaNominatim(nombre: string, ciudad: string, caja: [string, string, string, string]) {
  const lat = (Number(caja[0]) + Number(caja[1])) / 2;
  const lon = (Number(caja[2]) + Number(caja[3])) / 2;
  return {
    osm_type: "way",
    osm_id: 7,
    lat: String(lat),
    lon: String(lon),
    category: "tourism",
    type: "attraction",
    display_name: `${nombre}, ${ciudad}`,
    boundingbox: caja,
    namedetails: { name: nombre },
    extratags: {},
    address: { city: ciudad },
  };
}

function montarFuente(escenario: Escenario, reloj = crearRelojFalso(), cache = cacheSitiosMemoria()) {
  const peticiones: PeticionRegistrada[] = [];
  const fetchFalso = async (entrada: string): Promise<Response> => {
    const url = new URL(entrada);
    const inicio = reloj.ahora();
    const q = url.searchParams.get("q") ?? "";
    let cuerpo: unknown[] = [];
    if (url.searchParams.get("featureType") === "settlement") {
      const caja = escenario.asentamientos[q];
      cuerpo = caja ? [{ ...entradaNominatim(q, q, caja), boundingbox: caja }] : [];
    } else if (url.searchParams.get("bounded") === "1") {
      const nombre = q.split(",")[0].trim();
      const ciudad = escenario.ciudadDeParada(nombre);
      cuerpo = ciudad ? [entradaNominatim(nombre, ciudad, escenario.cajaDeCiudad)] : [];
    } else if (url.searchParams.get("addressdetails") === "1") {
      const ciudad = escenario.ciudadDeParada(q);
      cuerpo = ciudad ? [entradaNominatim(q, ciudad, escenario.cajaDeCiudad)] : [];
    }
    peticiones.push({ url, inicio, fin: reloj.ahora() });
    return new Response(JSON.stringify(cuerpo), { status: 200 });
  };
  const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache });
  return { fuente, peticiones };
}

const CAJA_LONDRES: [string, string, string, string] = ["51.28", "51.69", "-0.51", "0.33"];
const PARADAS_LONDRES = [
  "Natural History Museum",
  "Science Museum",
  "Hyde Park",
  "Tower of London",
  "British Museum",
  "London Eye",
  "Kensington Gardens",
  "Tower Bridge",
  "Buckingham Palace",
  "Regent's Park",
  "Camden Market",
  "Greenwich Park",
  "Covent Garden",
  "Borough Market",
  "Westminster Abbey",
  "St Paul's Cathedral",
  "Trafalgar Square",
  "Victoria and Albert Museum",
  "Sky Garden",
  "Shakespeare's Globe",
  "Madame Tussauds",
  "Kew Gardens",
  "Hampstead Heath",
  "Tate Modern",
];

// Londres: el destino descriptivo no geocodifica pero «Londres» sí, así que
// el peldaño del texto lo resuelve con 1 + 1 + 5 peticiones.
const LONDRES: Escenario = {
  asentamientos: { Londres: CAJA_LONDRES },
  ciudadDeParada: () => "London",
  cajaDeCiudad: CAJA_LONDRES,
};

describe("resolverCiudadEfectiva -- presupuesto de peticiones (cpn-ac1)", () => {
  // cp-cpn-01
  it("deduce Londres con como mucho 12 peticiones la primera vez y 0 con la caché llena", async () => {
    const cache = cacheSitiosMemoria();
    const primera = montarFuente(LONDRES, undefined, cache);
    const ciudad = await resolverCiudadEfectiva(primera.fuente, "Londres en familia con niños", PARADAS_LONDRES);
    expect(ciudad?.estado).toBe("resuelta");
    expect(ciudad?.nombre).toBe("Londres");
    expect(primera.peticiones.length).toBeGreaterThan(0);
    expect(primera.peticiones.length).toBeLessThanOrEqual(PETICIONES_MAXIMAS_POR_PLAN);

    const segunda = montarFuente(LONDRES, undefined, cache);
    const otra = await resolverCiudadEfectiva(segunda.fuente, "Londres en familia con niños", PARADAS_LONDRES);
    expect(otra?.nombre).toBe("Londres");
    expect(segunda.peticiones).toHaveLength(0);
  });

  it("un plan de 4 paradas hace como mucho 4 peticiones de búsqueda libre", async () => {
    const escenario: Escenario = { asentamientos: {}, ciudadDeParada: () => "Sevilla", cajaDeCiudad: ["37.3", "37.45", "-6.05", "-5.9"] };
    const { fuente, peticiones } = montarFuente(escenario);
    await resolverCiudadEfectiva(fuente, "Un destino que no geocodifica", ["Real Alcázar", "Catedral", "Giralda", "Metropol"]);
    const libres = peticiones.filter((p) => p.url.searchParams.get("limit") === "3");
    expect(libres.length).toBeLessThanOrEqual(4);
  });

  it("las respuestas servidas desde la caché no consumen presupuesto", async () => {
    const cache = cacheSitiosMemoria();
    const calentar = montarFuente(LONDRES, undefined, cache);
    await resolverCiudadEfectiva(calentar.fuente, "Londres en familia con niños", PARADAS_LONDRES);

    const presupuesto = crearPresupuestoPeticiones(PETICIONES_MAXIMAS_POR_PLAN);
    const { fuente } = montarFuente(LONDRES, undefined, cache);
    await resolverCiudadEfectiva(fuente, "Londres en familia con niños", PARADAS_LONDRES, presupuesto);
    expect(presupuesto.consumidas()).toBe(0);
  });

  it("con el presupuesto agotado y menos de 3 votos no da ciudad: queda inconcluso, nunca sellado", async () => {
    const escenario: Escenario = { asentamientos: {}, ciudadDeParada: () => "London", cajaDeCiudad: CAJA_LONDRES };
    const { fuente, peticiones } = montarFuente(escenario);
    const presupuesto = crearPresupuestoPeticiones(2);
    const ciudad = await resolverCiudadEfectiva(fuente, "Destino sin caja", PARADAS_LONDRES, presupuesto);
    expect(ciudad).toBeNull();
    expect(peticiones.length).toBeLessThanOrEqual(2);
  });

  it("con el presupuesto agotado y al menos 3 votos decide con los reunidos", async () => {
    const escenario: Escenario = { asentamientos: { London: CAJA_LONDRES }, ciudadDeParada: () => "London", cajaDeCiudad: CAJA_LONDRES };
    // La caja de la ciudad ya está en caché (otro plan de Londres): lo que se
    // prueba es que las paradas votadas antes de agotarse bastan para decidir.
    const cache = cacheSitiosMemoria();
    await montarFuente(escenario, undefined, cache).fuente.geocodificarCiudad("London");
    const { fuente } = montarFuente(escenario, undefined, cache);
    // Un destino de una sola palabra no genera candidatos de texto: 1 petición
    // del destino y 4 búsquedas libres (4 votos) agotan los 5 antes de las 8
    // paradas previstas.
    const presupuesto = crearPresupuestoPeticiones(5);
    const ciudad = await resolverCiudadEfectiva(fuente, "Destino", PARADAS_LONDRES, presupuesto);
    expect(ciudad?.estado).toBe("resuelta");
    expect(ciudad?.metodo).toBe("paradas");
    expect(ciudad?.nombre).toBe("London");
    expect(ciudad?.apoyo).toBe(4);
    expect(presupuesto.consumidas()).toBe(5);
  });
});

describe("resolverCiudadEfectiva -- ritmo de Nominatim con presupuesto (cpn-ac2)", () => {
  it("deja >= 1.100 ms entre peticiones y nunca hay dos en vuelo", async () => {
    const reloj = crearRelojFalso();
    const { fuente, peticiones } = montarFuente(LONDRES, reloj);
    await resolverCiudadEfectiva(fuente, "Londres en familia con niños", PARADAS_LONDRES);
    expect(peticiones.length).toBeGreaterThan(1);
    for (let i = 1; i < peticiones.length; i++) {
      expect(peticiones[i].inicio - peticiones[i - 1].inicio).toBeGreaterThanOrEqual(1100);
      expect(peticiones[i].inicio).toBeGreaterThanOrEqual(peticiones[i - 1].fin);
    }
  });

  const arbitrarioEscenario = fc.record({
    ciudades: fc.array(fc.constantFrom("London", "Westminster", "Camden", null), { minLength: 1, maxLength: 8 }),
    asentamiento: fc.boolean(),
  });
  const arbitrarioNombres = fc.array(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 60 });

  function escenarioDe(ciudades: (string | null)[], asentamiento: boolean): Escenario {
    return {
      asentamientos: asentamiento ? { "Destino raro": CAJA_LONDRES } : {},
      ciudadDeParada: (nombre) => ciudades[[...nombre].reduce((suma, c) => suma + c.charCodeAt(0), 0) % ciudades.length],
      cajaDeCiudad: CAJA_LONDRES,
    };
  }

  // Invariante 1
  it("para cualquier plan de 1 a 60 paradas, la deducción hace como mucho 12 peticiones de red", async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarioEscenario, arbitrarioNombres, async ({ ciudades, asentamiento }, nombres) => {
        const { fuente, peticiones } = montarFuente(escenarioDe(ciudades, asentamiento));
        await resolverCiudadEfectiva(fuente, "Destino raro con niños", nombres);
        expect(peticiones.length).toBeLessThanOrEqual(PETICIONES_MAXIMAS_POR_PLAN);
      }),
      { numRuns: 40 },
    );
  });

  // Invariante 3
  it("si la deducción sin tope no pasaba de 12 peticiones, la ciudad es idéntica con el tope", async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarioEscenario, arbitrarioNombres, async ({ ciudades, asentamiento }, nombres) => {
        const escenario = escenarioDe(ciudades, asentamiento);
        const sinTope = montarFuente(escenario);
        const antigua = await resolverCiudadEfectiva(sinTope.fuente, "Destino raro con niños", nombres, crearPresupuestoPeticiones(10_000));
        fc.pre(sinTope.peticiones.length <= PETICIONES_MAXIMAS_POR_PLAN);

        const conTope = montarFuente(escenario);
        const nueva = await resolverCiudadEfectiva(conTope.fuente, "Destino raro con niños", nombres);
        const sinFecha = (c: typeof antigua) => (c ? { ...c, intentado_en: "" } : c);
        expect(sinFecha(nueva)).toEqual(sinFecha(antigua));
      }),
      { numRuns: 40 },
    );
  });

  // Invariante 2
  it("repetir un plan con la caché llena no gasta ninguna petición, sea cual sea el plan", async () => {
    await fc.assert(
      fc.asyncProperty(arbitrarioEscenario, arbitrarioNombres, async ({ ciudades, asentamiento }, nombres) => {
        const escenario = escenarioDe(ciudades, asentamiento);
        const cache = cacheSitiosMemoria();
        // El tope por plan reparte el trabajo en intentos: se repite hasta que
        // el resultado deja de ser inconcluso (la caché crece en cada vuelta).
        let ciudad = null;
        for (let intento = 0; intento < 20 && ciudad === null; intento++) {
          ciudad = await resolverCiudadEfectiva(montarFuente(escenario, undefined, cache).fuente, "Destino raro con niños", nombres);
        }
        const presupuesto = crearPresupuestoPeticiones(PETICIONES_MAXIMAS_POR_PLAN);
        const final = montarFuente(escenario, undefined, cache);
        await resolverCiudadEfectiva(final.fuente, "Destino raro con niños", nombres, presupuesto);
        expect(final.peticiones).toHaveLength(0);
        expect(presupuesto.consumidas()).toBe(0);
      }),
      { numRuns: 25 },
    );
  });
});
