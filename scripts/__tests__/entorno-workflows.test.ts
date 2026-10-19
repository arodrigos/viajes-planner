import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { leerEnvSuperior, sonIguales } from "../entorno-workflows";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const leer = (f: string) => readFileSync(path.join(RAIZ, ".github/workflows", f), "utf8");

const VARIABLES = ["CORREOS_PERMITIDOS", "NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR"] as const;

describe("entorno de ci.yml y pruebas-a-demanda.yml", () => {
  const ci = leer("ci.yml");
  const demanda = leer("pruebas-a-demanda.yml");

  it.each(VARIABLES)("%s existe en ambos ficheros con el mismo valor", (nombre) => {
    const enCi = leerEnvSuperior(ci, nombre);
    const enDemanda = leerEnvSuperior(demanda, nombre);
    expect(enCi, `${nombre} falta en ci.yml`).toBeTruthy();
    expect(enDemanda, `${nombre} falta en pruebas-a-demanda.yml`).toBeTruthy();
    expect(sonIguales(enCi!, enDemanda!), `${nombre} difiere entre ci.yml y pruebas-a-demanda.yml`).toBe(true);
  });

  it("la lista de correos de ci.yml tiene más de 90 direcciones", () => {
    expect(leerEnvSuperior(ci, "CORREOS_PERMITIDOS")!.split(",").length).toBeGreaterThan(90);
  });

  it("un correo de menos en pruebas-a-demanda.yml se detecta", () => {
    const lista = leerEnvSuperior(ci, "CORREOS_PERMITIDOS")!;
    const recortada = lista.split(",").slice(0, -1).join(",");
    expect(sonIguales(lista, recortada)).toBe(false);
  });

  it("falta la variable: leerEnvSuperior devuelve undefined", () => {
    expect(leerEnvSuperior('name: x\nenv:\n  OTRA: "1"\njobs:\n', "CORREOS_PERMITIDOS")).toBeUndefined();
    expect(leerEnvSuperior('name: x\njobs:\n  a:\n    env:\n  CORREOS_PERMITIDOS: "x"\n', "CORREOS_PERMITIDOS")).toBeUndefined();
  });

  it("no confunde un env de un job con el de nivel superior", () => {
    const yaml = 'env:\n  A: "1"\njobs:\n  j:\n    env:\n      CORREOS_PERMITIDOS: "x"\n';
    expect(leerEnvSuperior(yaml, "CORREOS_PERMITIDOS")).toBeUndefined();
  });
});

describe("invariante: sonIguales", () => {
  it("da true si y solo si los textos son idénticos", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(sonIguales(a, b)).toBe(a === b);
      }),
    );
    fc.assert(
      fc.property(fc.string(), (a) => {
        expect(sonIguales(a, a)).toBe(true);
        expect(sonIguales(a, ` ${a}`)).toBe(false);
        expect(sonIguales(`${a},x`, `x,${a}`)).toBe(a === "x");
      }),
    );
  });
});
