import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { _reiniciarCacheRellenoParaTests, leerEstadoRelleno, tieneCuriosidadesAntiguas } from "@/lib/relleno";

// Doble mínimo del cliente encadenable de supabase-js: cada llamada a
// `.from(tabla)` abre una consulta nueva que termina en `.then`, momento en
// el que se cuenta como una consulta real de solo recuento (sal-ac2).
function clienteFalso() {
  let consultas = 0;
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    not: () => builder,
    neq: () => builder,
    in: () => builder,
    order: () => builder,
    range: () => builder,
    then(resolve: (valor: { count: number; error: null }) => void) {
      consultas += 1;
      resolve({ count: 1, error: null });
    },
  };
  return {
    from: () => builder,
    consultas: () => consultas,
  };
}

beforeEach(() => {
  _reiniciarCacheRellenoParaTests();
});

// sal-ac2: diez peticiones seguidas producen una sola tanda de consultas de
// solo recuento, y la undécima tras 61 s produce otra tanda nueva.
describe("leerEstadoRelleno (sal-ac2)", () => {
  it("diez lecturas dentro de 60 s hacen una sola tanda de consultas", async () => {
    const cliente = clienteFalso() as never;
    const inicio = 1_000_000;
    for (let i = 0; i < 10; i++) {
      await leerEstadoRelleno(cliente, inicio + i * 1_000);
    }
    expect((cliente as ReturnType<typeof clienteFalso>).consultas()).toBe(26);
  });

  it("tras 61 s desde la última tanda, se vuelve a consultar", async () => {
    const cliente = clienteFalso() as never;
    const inicio = 2_000_000;
    await leerEstadoRelleno(cliente, inicio);
    await leerEstadoRelleno(cliente, inicio + 61_000);
    expect((cliente as ReturnType<typeof clienteFalso>).consultas()).toBe(52);
  });

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): la lista crece de 12 a 19
  // claves con el desglose por categoría de los planes sellados -- sigue
  // siendo una lista CERRADA, solo con siete miembros más.
  it("el resultado cacheado tiene las veintiséis claves del objeto relleno", async () => {
    const cliente = clienteFalso() as never;
    const relleno = await leerEstadoRelleno(cliente, 3_000_000);
    expect(Object.keys(relleno).sort()).toEqual(
      [
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
      ].sort(),
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
