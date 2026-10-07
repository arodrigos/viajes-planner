import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { FORMATO_CURIOSIDADES } from "@/lib/guia/curiosidadesPlan";
import { _reiniciarCacheRellenoParaTests, leerEstadoRelleno } from "@/lib/relleno";
import { tieneCuriosidadesAntiguas } from "./referenciaRelleno";

const CLAVES = [
  "paradas_total",
  "paradas_resueltas",
  "paradas_no_resueltas",
  "paradas_en_error",
  "paradas_sin_intentar",
  "paradas_con_foto",
  "paradas_con_alternativas",
  "paradas_con_categoria",
  "paradas_con_guia",
  "paradas_con_motivo",
  "curiosidades_formato_antiguo",
  "versiones_con_eventos",
  "versiones_multiciudad",
  "trabajos_inviables",
  "planes_total",
  "planes_sin_version",
  "planes_sin_trabajo_vivo",
  "planes_con_ciudad",
  "planes_sin_ciudad_identificable",
  "planes_sellados_pocas_paradas",
  "planes_sellados_sin_caja",
  "planes_sellados_zona_grande",
  "planes_sellados_sin_contencion",
  "planes_sellados_sin_ventaja",
  "planes_sellados_sin_candidato_claro",
  "planes_sellados_ciudad_no_encontrada",
] as const;

const relleno = (valor: number): Record<string, number> => Object.fromEntries(CLAVES.map((clave) => [clave, valor]));

// Doble mínimo del cliente: lo único que importa es cuántas llamadas hace y
// con qué nombre, porque la función SQL se comprueba contra Postgres real en
// el test de integración y en scripts/verificar-bd-prueba.sh.
function clienteFalso(respuesta: { data: unknown; error: { message: string } | null }) {
  const llamadas: Array<{ nombre: string; argumentos: unknown }> = [];
  return {
    rpc: (nombre: string, argumentos: unknown) => {
      llamadas.push({ nombre, argumentos });
      return Promise.resolve(respuesta);
    },
    from: () => {
      throw new Error("leerEstadoRelleno no debe leer tablas");
    },
    llamadas,
  };
}

beforeEach(() => {
  _reiniciarCacheRellenoParaTests();
});

// sal-ac1/sal-ac2: una sola llamada rpc, cacheada 60 s.
describe("leerEstadoRelleno (sal-ac1, sal-ac2)", () => {
  it("diez lecturas dentro de 60 s hacen una sola llamada rpc con el formato vigente", async () => {
    const cliente = clienteFalso({ data: relleno(1), error: null });
    const inicio = 1_000_000;
    for (let i = 0; i < 10; i++) {
      await leerEstadoRelleno(cliente as never, inicio + i * 1_000);
    }
    expect(cliente.llamadas).toEqual([{ nombre: "estado_relleno", argumentos: { p_formato_curiosidades: FORMATO_CURIOSIDADES } }]);
  });

  it("tras 61 s desde la última llamada, se vuelve a consultar", async () => {
    const cliente = clienteFalso({ data: relleno(1), error: null });
    const inicio = 2_000_000;
    await leerEstadoRelleno(cliente as never, inicio);
    await leerEstadoRelleno(cliente as never, inicio + 61_000);
    expect(cliente.llamadas).toHaveLength(2);
  });

  it("el resultado tiene las veintiséis claves del objeto relleno", async () => {
    const resultado = await leerEstadoRelleno(clienteFalso({ data: relleno(3), error: null }) as never, 3_000_000);
    expect(Object.keys(resultado).sort()).toEqual([...CLAVES].sort());
  });

  it("un error de la rpc se propaga para que /api/salud omita relleno", async () => {
    await expect(leerEstadoRelleno(clienteFalso({ data: null, error: { message: "boom" } }) as never)).rejects.toThrow("boom");
  });

  // Invariante: /api/salud es público, así que solo se publica un objeto con
  // exactamente la lista cerrada de claves y enteros >= 0, para cualquier
  // respuesta de la base.
  it("rechaza cualquier respuesta que no sea exactamente la lista cerrada de enteros no negativos", async () => {
    const malos = fc.oneof(
      fc.constant(null),
      fc.string(),
      fc.array(fc.integer()),
      fc.constantFrom(...CLAVES).map((faltante) => {
        const sin = relleno(1);
        delete sin[faltante];
        return sin;
      }),
      fc.string({ minLength: 1 }).filter((c) => !(CLAVES as readonly string[]).includes(c)).map((extra) => ({ ...relleno(1), [extra]: 1 })),
      fc.tuple(fc.constantFrom(...CLAVES), fc.oneof(fc.integer({ max: -1 }), fc.double({ noInteger: true, noNaN: true }), fc.string(), fc.constant(null))).map(([clave, valor]) => ({
        ...relleno(1),
        [clave]: valor,
      })),
    );
    await fc.assert(
      fc.asyncProperty(malos, async (data) => {
        _reiniciarCacheRellenoParaTests();
        await expect(leerEstadoRelleno(clienteFalso({ data, error: null }) as never)).rejects.toThrow();
      }),
      { numRuns: 60 },
    );
  });

  it("acepta cualquier objeto con las claves de la lista y enteros no negativos", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: CLAVES.length, maxLength: CLAVES.length }), async (valores) => {
        _reiniciarCacheRellenoParaTests();
        const data = Object.fromEntries(CLAVES.map((clave, i) => [clave, valores[i]]));
        expect(await leerEstadoRelleno(clienteFalso({ data, error: null }) as never)).toEqual(data);
      }),
      { numRuns: 30 },
    );
  });
});

// rp-ac4: el contador de /api/salud cuenta solo lo que el trabajador rehará.
describe("tieneCuriosidadesAntiguas (rp-ac4)", () => {
  const item = { texto: "x", idioma: "es", fuente: "wikipedia", url: "u", seleccion: "modelo" };

  it("cuenta items con formato anterior o sin formato, y no cuenta lo vigente ni lo vacío", () => {
    expect(tieneCuriosidadesAntiguas({ formato: 4, items: [item] }, 5)).toBe(true);
    expect(tieneCuriosidadesAntiguas({ items: [item] }, 5)).toBe(true);
    expect(tieneCuriosidadesAntiguas({ formato: 5, items: [item] }, 5)).toBe(false);
    expect(tieneCuriosidadesAntiguas({ formato: 4, items: [] }, 5)).toBe(false);
    expect(tieneCuriosidadesAntiguas(null, 5)).toBe(false);
    expect(tieneCuriosidadesAntiguas("texto", 5)).toBe(false);
  });

  it("para cualquier lista de filas, el recuento es un entero entre 0 y el número de filas", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(null), fc.record({ formato: fc.option(fc.integer({ min: 0, max: 9 })), items: fc.array(fc.constant(item), { maxLength: 3 }) })), { maxLength: 40 }),
        (filas) => {
          const n = filas.filter((f) => tieneCuriosidadesAntiguas(f, 5)).length;
          return Number.isInteger(n) && n >= 0 && n <= filas.length;
        },
      ),
      { numRuns: 30 },
    );
  });
});
