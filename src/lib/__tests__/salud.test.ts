import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { construirSalud, ESQUEMA_VERSION } from "@/lib/salud";

const COMMIT_SHA_ORIGINAL = process.env.COMMIT_SHA;

beforeEach(() => {
  process.env.COMMIT_SHA = "a".repeat(40);
});

afterEach(() => {
  process.env.COMMIT_SHA = COMMIT_SHA_ORIGINAL;
});

// esqueleto-ac1: cada campo que el smoke_test del manifiesto exige con jq
// tiene que salir con su nombre y forma exactos, no solo "estar ahí".
describe("construirSalud", () => {
  it("sin opciones, es ok con solo el commit y ningún campo opcional", () => {
    const salud = construirSalud();
    expect(salud.ok).toBe(true);
    expect(salud).not.toHaveProperty("supabase");
    expect(salud).not.toHaveProperty("trabajador");
  });

  it("deja de ser ok si el commit no tiene 40 caracteres", () => {
    process.env.COMMIT_SHA = "corto";
    expect(construirSalud().ok).toBe(false);
  });

  it("deja de ser ok si alguna dependencia declarada falla", () => {
    const salud = construirSalud({ dependencias: [{ nombre: "x", ok: false, detalle: "boom" }] });
    expect(salud.ok).toBe(false);
  });

  it("expone supabase, esquema, esquema_version, modelo_acceso, trabajador, secretos_faltantes y credenciales_modelo_en_web", () => {
    const salud = construirSalud({
      cronsRegistrados: 1,
      supabase: "activa",
      esquema: "viajes_planner",
      esquemaVersion: ESQUEMA_VERSION,
      modeloAcceso: "suscripcion-vps1",
      trabajadorVistoHaceSeg: 42,
      secretosFaltantes: [],
      credencialesModeloEnWeb: false,
    });

    expect(salud).toMatchObject({
      crons_registrados: 1,
      supabase: "activa",
      esquema: "viajes_planner",
      esquema_version: 2,
      modelo_acceso: "suscripcion-vps1",
      trabajador: { visto_hace_seg: 42 },
      secretos_faltantes: [],
      credenciales_modelo_en_web: false,
    });
  });

  it("trabajador.visto_hace_seg puede ser null (todavía no hay ninguna lectura)", () => {
    const salud = construirSalud({ trabajadorVistoHaceSeg: null });
    expect(salud.trabajador).toEqual({ visto_hace_seg: null });
  });

  // lug-ac6: el smoke_test del manifiesto exige exactamente este objeto.
  it("expone fuentes.lugares y fuentes.mapa cuando se pasan", () => {
    const salud = construirSalud({ fuentes: { lugares: "osm+wikipedia", mapa: "openfreemap" } });
    expect(salud.fuentes).toEqual({ lugares: "osm+wikipedia", mapa: "openfreemap" });
  });

  it("no incluye fuentes cuando no se pasa", () => {
    expect(construirSalud()).not.toHaveProperty("fuentes");
  });

  // sal-ac1/sal-ac3/bar-ac4: la lista cerrada de claves de `relleno`, todas
  // numéricas -- diecinueve desde que bar-ac4 suma el desglose por
  // categoría de los planes sellados.
  it("expone relleno con las diecinueve claves cerradas cuando se pasa", () => {
    const relleno = {
      paradas_total: 467,
      paradas_resueltas: 0,
      paradas_no_resueltas: 22,
      paradas_en_error: 24,
      paradas_sin_intentar: 421,
      paradas_con_foto: 0,
      paradas_con_alternativas: 0,
      paradas_con_categoria: 0,
      paradas_con_guia: 0,
      versiones_con_eventos: 0,
      planes_total: 6,
      planes_sin_version: 1,
      planes_sin_trabajo_vivo: 3,
      planes_con_ciudad: 2,
      planes_sin_ciudad_identificable: 1,
      planes_sellados_pocas_paradas: 0,
      planes_sellados_sin_caja: 0,
      planes_sellados_zona_grande: 0,
      planes_sellados_sin_contencion: 0,
      planes_sellados_sin_ventaja: 0,
      planes_sellados_sin_candidato_claro: 1,
      planes_sellados_ciudad_no_encontrada: 0,
    };
    const salud = construirSalud({ relleno });
    expect(salud.relleno).toEqual(relleno);
    expect(Object.keys(salud.relleno!).sort()).toEqual(Object.keys(relleno).sort());
  });

  it("no incluye relleno cuando no se pasa", () => {
    expect(construirSalud()).not.toHaveProperty("relleno");
  });

  // bar-ac4: commit_sha y ultimo_resultado solo aparecen junto a
  // visto_hace_seg -- sin ellos, "código viejo" y "excepción silenciosa" eran
  // indistinguibles desde fuera.
  it("expone trabajador.commit_sha y trabajador.ultimo_resultado cuando se pasan", () => {
    const ultimoResultado = { ok: false, trabajos_procesados: 0, planes_mirados: 3, paradas_intentadas: 0, error: "boom" };
    const salud = construirSalud({
      trabajadorVistoHaceSeg: 42,
      trabajadorCommitSha: "c66ade5",
      trabajadorUltimoResultado: ultimoResultado,
    });
    expect(salud.trabajador).toEqual({
      visto_hace_seg: 42,
      commit_sha: "c66ade5",
      // cam-ac4: el texto del error ya no sale, solo su categoría.
      ultimo_resultado: { ok: false, trabajos_procesados: 0, planes_mirados: 3, paradas_intentadas: 0, categoria: "desconocido" },
    });
  });
});
