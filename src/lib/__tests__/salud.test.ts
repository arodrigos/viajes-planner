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
});
