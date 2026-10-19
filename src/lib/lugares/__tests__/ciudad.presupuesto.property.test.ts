import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cacheSitiosMemoria, claveNominatim } from "../cacheSitios";
import { candidatosDesdeTextoDestino, PETICIONES_MAXIMAS_POR_PLAN, resolverCiudadEfectiva, VERSION_RESOLUTOR_ACTUAL } from "../ciudad";
import { crearFuenteAbierta } from "../fuenteAbierta";
import type { Reloj } from "../limitador";
import { crearPresupuestoPeticiones, type CajaDelimitadora } from "../tipos";

// rel-ac3: invariantes del presupuesto para CUALQUIER destino y lista de
// paradas, medidas sobre el fetch (lo que de verdad sale a la red) y no sobre
// llamadas a un doble.

const reloj: Reloj = { ahora: () => 0, dormir: async () => {} };
const CAJA_VALIDA: [string, string, string, string] = ["37.30", "37.45", "-6.05", "-5.85"];
const PUNTO_SIN_AREA: [string, string, string, string] = ["10.5", "10.5", "20.5", "20.5"];

function entrada(nombre: string, ciudad: string, caja: [string, string, string, string]) {
  return {
    osm_type: "way",
    osm_id: 1,
    lat: String((Number(caja[0]) + Number(caja[1])) / 2),
    lon: String((Number(caja[2]) + Number(caja[3])) / 2),
    category: "tourism",
    type: "attraction",
    display_name: `${nombre}, ${ciudad}`,
    boundingbox: caja,
    namedetails: { name: nombre },
    extratags: {},
    address: { city: ciudad },
  };
}

function montar(opciones: { cajaDestino: [string, string, string, string] | null; ciudadDeParada: (nombre: string) => string | null }) {
  const peticiones: URL[] = [];
  const fetchFalso = async (u: string): Promise<Response> => {
    const url = new URL(u);
    peticiones.push(url);
    const q = url.searchParams.get("q") ?? "";
    let cuerpo: unknown[] = [];
    if (url.searchParams.get("featureType") === "settlement") {
      cuerpo = [{ ...entrada(q, q, CAJA_VALIDA), boundingbox: CAJA_VALIDA }];
    } else if (url.searchParams.get("bounded") === "1") {
      const nombre = q.split(",")[0].trim();
      const ciudad = opciones.ciudadDeParada(nombre);
      cuerpo = ciudad ? [entrada(nombre, ciudad, CAJA_VALIDA)] : [];
    } else if (url.searchParams.get("addressdetails") === "1") {
      const ciudad = opciones.ciudadDeParada(q);
      cuerpo = ciudad ? [entrada(q, ciudad, CAJA_VALIDA)] : [];
    } else if (opciones.cajaDestino) {
      cuerpo = [{ ...entrada(q, q, opciones.cajaDestino), boundingbox: opciones.cajaDestino }];
    }
    return new Response(JSON.stringify(cuerpo), { status: 200 });
  };
  return { fuente: crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() }), peticiones };
}

const destinos = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
  fc.constantFrom("Ciudad con niños", "Escapada en familia", "Playa", "Londres en familia con niños", "Isla del Sol con amigos", "Oporto"),
);
const nombres = fc.array(fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s.trim().length > 0), { minLength: 0, maxLength: 40 });
const cajas = fc.constantFrom<[string, string, string, string] | null>(PUNTO_SIN_AREA, CAJA_VALIDA, null);
const ciudades = fc.constantFrom<string | null>("Sevilla", "Madrid", null);

describe("resolverCiudadEfectiva -- invariantes de presupuesto (rel-ac3)", () => {
  it("nunca pasa de PETICIONES_MAXIMAS_POR_PLAN peticiones de red", async () => {
    await fc.assert(
      fc.asyncProperty(destinos, nombres, cajas, ciudades, async (destino, paradas, cajaDestino, ciudad) => {
        const { fuente, peticiones } = montar({ cajaDestino, ciudadDeParada: () => ciudad });
        await resolverCiudadEfectiva(fuente, destino, paradas);
        expect(peticiones.length).toBeLessThanOrEqual(PETICIONES_MAXIMAS_POR_PLAN);
      }),
      { numRuns: 100 },
    );
  });

  it("con la caja del destino sin área no hay ninguna búsqueda acotada en ella", async () => {
    await fc.assert(
      fc.asyncProperty(nombres, async (paradas) => {
        // Una sola palabra: no genera candidatos de texto, así que cualquier
        // búsqueda acotada sería la muestra de intentarCajaDelDestino.
        const { fuente, peticiones } = montar({ cajaDestino: PUNTO_SIN_AREA, ciudadDeParada: () => "Sevilla" });
        await resolverCiudadEfectiva(fuente, "Destino", paradas);
        expect(peticiones.filter((p) => p.searchParams.get("bounded") === "1")).toHaveLength(0);
      }),
      { numRuns: 60 },
    );
  });

  it("toda ciudad devuelta lleva la versión vigente y, si es «resuelta», nombre y una caja con área", async () => {
    await fc.assert(
      fc.asyncProperty(destinos, nombres, cajas, ciudades, async (destino, paradas, cajaDestino, ciudad) => {
        const { fuente } = montar({ cajaDestino, ciudadDeParada: () => ciudad });
        const resultado = await resolverCiudadEfectiva(fuente, destino, paradas, crearPresupuestoPeticiones(PETICIONES_MAXIMAS_POR_PLAN));
        if (resultado === null) return;
        expect(resultado.version_resolutor).toBe(VERSION_RESOLUTOR_ACTUAL);
        if (resultado.estado === "resuelta") {
          expect(resultado.nombre).toBeTruthy();
          expect(resultado.caja!.maxLat - resultado.caja!.minLat).toBeGreaterThan(0);
          expect(resultado.caja!.maxLon - resultado.caja!.minLon).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("candidatosDesdeTextoDestino (rel-ac3)", () => {
  const GENERICOS = ["ciudad", "pueblo", "playa", "costa", "montana", "sierra", "escapada", "viaje", "ruta", "centro", "capital", "isla", "vacaciones"];
  const sinTilde = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  it("nunca devuelve un genérico, el destino completo ni más de 3 candidatos", () => {
    const palabra = fc.constantFrom("Ciudad", "Playa", "Montaña", "Isla", "con", "de", "niños", "Londres", "Oporto", "Costa", "Viaje", "en", "familia", "Lisboa");
    fc.assert(
      fc.property(fc.array(palabra, { minLength: 1, maxLength: 6 }), (palabras) => {
        const destino = palabras.join(" ");
        const candidatos = candidatosDesdeTextoDestino(destino);
        expect(candidatos.length).toBeLessThanOrEqual(3);
        for (const c of candidatos) {
          expect(c).not.toBe(destino);
          expect(GENERICOS).not.toContain(sinTilde(c));
        }
      }),
    );
  });

  it("«Ciudad con niños» no genera ningún candidato y «Londres en familia con niños» genera «Londres»", () => {
    expect(candidatosDesdeTextoDestino("Ciudad con niños")).toEqual([]);
    expect(candidatosDesdeTextoDestino("Londres en familia con niños")).toContain("Londres");
  });
});

describe("claveNominatim (rel-ac3)", () => {
  it("la misma búsqueda en cajas distintas nunca comparte clave", () => {
    const caja = fc.record({
      minLat: fc.double({ min: -80, max: 80, noNaN: true }),
      maxLat: fc.double({ min: -80, max: 80, noNaN: true }),
      minLon: fc.double({ min: -170, max: 170, noNaN: true }),
      maxLon: fc.double({ min: -170, max: 170, noNaN: true }),
    });
    fc.assert(
      fc.property(caja, caja, (a: CajaDelimitadora, b: CajaDelimitadora) => {
        const redondeada = (c: CajaDelimitadora) => [c.minLat, c.maxLat, c.minLon, c.maxLon].map((v) => v.toFixed(4)).join();
        fc.pre(redondeada(a) !== redondeada(b));
        expect(claveNominatim("sevilla", "giralda", a)).not.toBe(claveNominatim("sevilla", "giralda", b));
      }),
    );
  });
});
