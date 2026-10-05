import { beforeEach, describe, expect, it } from "vitest";
import { _reiniciarCacheRellenoParaTests, leerEstadoRelleno } from "@/lib/relleno";

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
    expect((cliente as ReturnType<typeof clienteFalso>).consultas()).toBe(20);
  });

  it("tras 61 s desde la última tanda, se vuelve a consultar", async () => {
    const cliente = clienteFalso() as never;
    const inicio = 2_000_000;
    await leerEstadoRelleno(cliente, inicio);
    await leerEstadoRelleno(cliente, inicio + 61_000);
    expect((cliente as ReturnType<typeof clienteFalso>).consultas()).toBe(40);
  });

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): la lista crece de 12 a 19
  // claves con el desglose por categoría de los planes sellados -- sigue
  // siendo una lista CERRADA, solo con siete miembros más.
  it("el resultado cacheado tiene las veinte claves del objeto relleno", async () => {
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
