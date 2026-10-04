import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { procesarDentroDePresupuesto, resolverPuertaDeCiudad, seleccionarPendientes } from "@/lib/trabajador/barrido";
import { crearFuenteLugaresGrabada } from "@/lib/lugares/fuenteGrabada";
import { VERSION_RESOLUTOR_ACTUAL, type CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { CajaDelimitadora, CandidatoLugar, FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";
import type { Reloj } from "@/lib/lugares/limitador";

// bar-ac3: tope y presupuesto, con reloj falso y sin tocar Supabase --
// completarParadasPendientes delega esta parte en procesarDentroDePresupuesto
// precisamente para que esto se pueda probar con `npm test`, no solo con
// `npm run test:integration`.
describe("seleccionarPendientes -- tope a gran escala (bar-ac3)", () => {
  it("con 300 candidatos y límite 120, selecciona exactamente 120", () => {
    const candidatos = Array.from({ length: 300 }, (_, i) => ({ paradaId: `p${i}`, fecha: "2026-11-01" }));
    const seleccionados = seleccionarPendientes(candidatos, 120, "2026-10-04");
    expect(seleccionados).toHaveLength(120);
  });
});

function relojFalso(): Reloj {
  let tiempo = 0;
  return {
    ahora: () => tiempo,
    dormir: async (ms: number) => {
      tiempo += ms;
    },
  };
}

describe("procesarDentroDePresupuesto (bar-ac3)", () => {
  it("con presupuesto amplio, procesa todos los seleccionados", async () => {
    const seleccionados = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const reloj = relojFalso();
    const procesadas: string[] = [];
    const procesados = await procesarDentroDePresupuesto(seleccionados, 180_000, reloj, async (c) => {
      procesadas.push(c);
    });
    expect(procesados).toBe(10);
    expect(procesadas).toEqual(seleccionados);
  });

  it("agota el presupuesto antes de procesar todos: ninguna parada queda a medias", async () => {
    const seleccionados = Array.from({ length: 120 }, (_, i) => `c${i}`);
    // Cada "petición" cuesta 2.000 ms de reloj -- con 180.000 ms de
    // presupuesto, caben como mucho 90 antes de agotarlo.
    let tiempo = 0;
    const reloj: Reloj = { ahora: () => tiempo, dormir: async () => {} };
    const procesadas: string[] = [];
    const procesados = await procesarDentroDePresupuesto(seleccionados, 180_000, reloj, async (c) => {
      procesadas.push(c);
      tiempo += 2_000;
    });
    expect(procesados).toBeLessThan(120);
    expect(procesados).toBe(procesadas.length);
    // La última empezada antes de agotar el presupuesto: nunca se arranca
    // una tarea con el reloj ya por encima de 180.000 ms.
    expect((procesados - 1) * 2_000).toBeLessThan(180_000);
  });

  it("con 10 candidatos y presupuesto amplio, sale sin agotar el presupuesto", async () => {
    const seleccionados = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const reloj = relojFalso();
    const procesados = await procesarDentroDePresupuesto(seleccionados, 180_000, reloj, async () => {});
    expect(procesados).toBe(10);
  });
});

const CAJA: CajaDelimitadora = { minLat: 37.3, maxLat: 37.45, minLon: -6.05, maxLon: -5.9 };

function candidatoDePrueba(nombre: string): CandidatoLugar {
  return {
    fuente: "osm",
    id: `osm:node/${nombre}`,
    url: `https://www.openstreetmap.org/node/${nombre}`,
    nombreFuente: nombre,
    nombresAlternativos: [],
    lat: 37.38,
    lon: -5.98,
    categoriaOsm: "historic",
    tipoOsm: "memorial",
    etiquetas: {},
  };
}

function fuenteQueLanzaSiSeLlama(): FuenteLugares & FuenteCiudad {
  const lanzar = () => {
    throw new Error("bar-ac2: no se esperaba ninguna petición de red para este plan");
  };
  return {
    geocodificarDestino: lanzar,
    buscarNominatim: lanzar,
    buscarWikipedia: lanzar,
    buscarLibre: lanzar,
    geocodificarCiudad: lanzar,
  };
}

function supabaseQueLanzaSiSeEscribe(): { from: () => never } {
  return {
    from(): never {
      throw new Error("bar-ac2: no se esperaba ninguna escritura a Supabase para este plan");
    },
  };
}

function supabaseQueRegistra(): { registros: Array<{ tabla: string; valores: unknown; id: string }>; cliente: { from: (t: string) => unknown } } {
  const registros: Array<{ tabla: string; valores: unknown; id: string }> = [];
  const cliente = {
    from(tabla: string) {
      return {
        update(valores: unknown) {
          return {
            eq(_col: string, id: string) {
              registros.push({ tabla, valores, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { registros, cliente };
}

function version(ciudad: CiudadEfectiva | null) {
  return { id: "v1", planId: "plan1", destino: "Sevilla", ciudad, dias: [] };
}

describe("resolverPuertaDeCiudad (bar-ac1/bar-ac2)", () => {
  it("ciudad 'sin-ciudad-identificable' sellada por la versión VIGENTE: cero peticiones de red y ninguna escritura, devuelve null", async () => {
    const resultado = await resolverPuertaDeCiudad(
      supabaseQueLanzaSiSeEscribe() as never,
      fuenteQueLanzaSiSeLlama(),
      version({
        estado: "sin-ciudad-identificable",
        motivo: "no hay una ciudad clara",
        intentado_en: "2026-10-04T10:00:00Z",
        version_resolutor: VERSION_RESOLUTOR_ACTUAL,
      }),
      ["Monumento Uno"],
    );
    expect(resultado).toBeNull();
  });

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): esto es lo que hace que
  // los 27 planes marcados por el resolutor ANTERIOR a ciu-ac2 vuelvan a
  // entrar una vez en vez de quedarse bloqueados para siempre.
  it("ciudad 'sin-ciudad-identificable' sellada por una versión ANTERIOR (o sin sello): se reintenta una vez y el nuevo veredicto queda sellado con la versión vigente", async () => {
    const { registros, cliente } = supabaseQueRegistra();
    const bbox = CAJA;
    const fuente: FuenteLugares & FuenteCiudad = {
      geocodificarDestino: async () => bbox,
      buscarNominatim: async (nombre: string) => [candidatoDePrueba(nombre)],
      buscarWikipedia: async () => [],
      buscarLibre: async () => [],
      geocodificarCiudad: async () => bbox,
    };
    const resultado = await resolverPuertaDeCiudad(
      cliente as never,
      fuente,
      version({
        estado: "sin-ciudad-identificable",
        motivo: "no hay una ciudad clara",
        intentado_en: "2026-10-01T00:00:00Z",
        // sin version_resolutor: lo que escribió cualquier resolutor
        // previo a este bloque.
      }),
      ["Real Alcázar", "Catedral de Sevilla"],
    );
    expect(resultado).not.toBeNull();
    expect(registros).toHaveLength(1);
    const ciudadPersistida = (registros[0].valores as { ciudad: CiudadEfectiva }).ciudad;
    expect(ciudadPersistida.estado).toBe("resuelta");
    expect(ciudadPersistida.version_resolutor).toBe(VERSION_RESOLUTOR_ACTUAL);
  });

  it("ciudad ya 'resuelta': cero peticiones de red y ninguna escritura, devuelve su nombre/caja tal cual", async () => {
    const resultado = await resolverPuertaDeCiudad(
      supabaseQueLanzaSiSeEscribe() as never,
      fuenteQueLanzaSiSeLlama(),
      version({ estado: "resuelta", metodo: "destino", nombre: "Sevilla", caja: CAJA, intentado_en: "2026-10-04T10:00:00Z" }),
      ["Real Alcázar"],
    );
    expect(resultado).toEqual({ nombre: "Sevilla", caja: CAJA });
  });

  it("ciudad null: la resuelve una vez (vía resolverCiudadEfectiva) y la persiste en planes.ciudad", async () => {
    const libres: Record<string, CandidatoLugar[]> = {};
    const fuente = crearFuenteLugaresGrabada({
      destinos: { Sevilla: CAJA },
      nominatim: {
        "Real Alcázar::Sevilla": [{ fuente: "osm", id: "1", url: "u", nombreFuente: "Real Alcázar", nombresAlternativos: [], lat: 37.38, lon: -5.99, etiquetas: {} }],
        "Catedral de Sevilla::Sevilla": [{ fuente: "osm", id: "2", url: "u", nombreFuente: "Catedral de Sevilla", nombresAlternativos: [], lat: 37.38, lon: -5.99, etiquetas: {} }],
      },
      libres,
    });
    const { registros, cliente } = supabaseQueRegistra();
    const resultado = await resolverPuertaDeCiudad(cliente as never, fuente, version(null), ["Real Alcázar", "Catedral de Sevilla"]);
    expect(resultado).toEqual({ nombre: "Sevilla", caja: CAJA });
    expect(registros).toHaveLength(1);
    expect(registros[0].tabla).toBe("planes");
    expect(registros[0].id).toBe("plan1");
    expect((registros[0].valores as { ciudad: CiudadEfectiva }).ciudad.estado).toBe("resuelta");
  });

  it("ciudad 'pendiente-manual' que SÍ geocodifica: pasa a 'resuelta' con metodo 'manual' y se persiste", async () => {
    const fuente: FuenteLugares & FuenteCiudad = {
      geocodificarDestino: async () => null,
      buscarNominatim: async () => [],
      buscarWikipedia: async () => [],
      buscarLibre: async () => [],
      geocodificarCiudad: async (nombre: string) => (nombre === "Sevilla" ? CAJA : null),
    };
    const { registros, cliente } = supabaseQueRegistra();
    const resultado = await resolverPuertaDeCiudad(
      cliente as never,
      fuente,
      version({ estado: "pendiente-manual", nombre_pedido: "Sevilla", intentado_en: "2026-10-04T10:00:00Z" }),
      [],
    );
    expect(resultado).toEqual({ nombre: "Sevilla", caja: CAJA });
    expect(registros).toHaveLength(1);
    const ciudadPersistida = (registros[0].valores as { ciudad: CiudadEfectiva }).ciudad;
    expect(ciudadPersistida.estado).toBe("resuelta");
    expect(ciudadPersistida.metodo).toBe("manual");
  });

  it("ciudad 'pendiente-manual' que NO geocodifica: vuelve a 'sin-ciudad-identificable' con motivo que nombra el texto pedido", async () => {
    const fuente: FuenteLugares & FuenteCiudad = {
      geocodificarDestino: async () => null,
      buscarNominatim: async () => [],
      buscarWikipedia: async () => [],
      buscarLibre: async () => [],
      geocodificarCiudad: async () => null,
    };
    const { registros, cliente } = supabaseQueRegistra();
    const resultado = await resolverPuertaDeCiudad(
      cliente as never,
      fuente,
      version({ estado: "pendiente-manual", nombre_pedido: "Xyzzyborg", intentado_en: "2026-10-04T10:00:00Z" }),
      [],
    );
    expect(resultado).toBeNull();
    const ciudadPersistida = (registros[0].valores as { ciudad: CiudadEfectiva }).ciudad;
    expect(ciudadPersistida.estado).toBe("sin-ciudad-identificable");
    expect(ciudadPersistida.motivo).toContain("Xyzzyborg");
  });

  it("invariante: para cualquier ciudad ya en estado 'sin-ciudad-identificable' sellada con la versión VIGENTE, nunca hay petición de red", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (motivo) => {
        const resultado = await resolverPuertaDeCiudad(
          supabaseQueLanzaSiSeEscribe() as never,
          fuenteQueLanzaSiSeLlama(),
          version({ estado: "sin-ciudad-identificable", motivo, intentado_en: "2026-10-04T10:00:00Z", version_resolutor: VERSION_RESOLUTOR_ACTUAL }),
          ["cualquier parada"],
        );
        expect(resultado).toBeNull();
      }),
      { numRuns: 15 },
    );
  });
});
