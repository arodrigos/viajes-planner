import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// grt-ac4: el oráculo de DEV contra respuestas dobladas de la Management API.
const SCRIPT = path.resolve(import.meta.dirname, "../verificar-privilegios-reales.sh");
const LIMPIO = { tabla: 0, columna: 0, secuencia: 0, rutina: 0, def_esquema: 0, def_global: 0, n_rel: 19, n_seq: 0, n_fun: 14 };

let servidor: Server;
let consultas: string[];
let respuesta: unknown;

beforeEach(async () => {
  consultas = [];
  servidor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (t) => (cuerpo += t));
    req.on("end", () => {
      consultas.push((JSON.parse(cuerpo) as { query: string }).query);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(respuesta));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
});

afterEach(() => new Promise<void>((ok) => servidor.close(() => ok())));

function ejecutar(parcial: Partial<typeof LIMPIO>, entorno: Record<string, string>, args: string[] = []) {
  respuesta = [{ ...LIMPIO, ...parcial }];
  const puerto = (servidor.address() as AddressInfo).port;
  return new Promise<{ codigo: number; salida: string }>((ok) => {
    const proceso = spawn("bash", [SCRIPT, ...args], {
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        SUPABASE_PROJECT_REF: "ref-de-prueba",
        SUPABASE_ACCESS_TOKEN: "token-de-prueba",
        API_SUPABASE: `http://127.0.0.1:${puerto}`,
        ...entorno,
      },
    });
    let salida = "";
    proceso.stdout.on("data", (t) => (salida += t));
    proceso.stderr.on("data", (t) => (salida += t));
    proceso.on("close", (codigo) => ok({ codigo: codigo ?? -1, salida }));
  });
}

const CI = { GITHUB_ACTIONS: "true" };
const NOMBRES_PROHIBIDOS = /planes|trabajos|anon|authenticated|postgres|supabase_admin/i;

describe("verificar-privilegios-reales.sh (grt-ac4)", () => {
  it("limpio: sale con 0 y la línea OK con los recuentos", async () => {
    const r = await ejecutar({}, CI);
    expect(r.codigo).toBe(0);
    expect(r.salida.trim().split("\n").pop()).toBe("OK: anon y authenticated sin privilegios en viajes_planner (19 relaciones, 0 secuencias, 14 rutinas)");
  });

  it.each([
    [{ tabla: 1 }, "FALLO: 1 privilegio(s) de relación (tabla) para roles de la Data API"],
    [{ columna: 1 }, "FALLO: 1 privilegio(s) de relación (columna) para roles de la Data API"],
    [{ secuencia: 2 }, "FALLO: 2 privilegio(s) de secuencia"],
    [{ rutina: 1 }, "FALLO: 1 privilegio(s) de rutina"],
  ])("un privilegio sobre un objeto %o sale con 1 sin nombrar nada", async (parcial, mensaje) => {
    const r = await ejecutar(parcial, CI);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(mensaje);
    expect(r.salida).not.toMatch(NOMBRES_PROHIBIDOS);
  });

  it.each([
    [{ def_global: 1 }, "FALLO: 1 privilegio(s) por defecto (global)"],
    [{ def_esquema: 1 }, "FALLO: 1 privilegio(s) por defecto (esquema)"],
  ])("un privilegio por defecto %o sale con 2", async (parcial, mensaje) => {
    const r = await ejecutar(parcial, CI);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain(mensaje);
    expect(r.salida).not.toMatch(NOMBRES_PROHIBIDOS);
  });

  it("solo ejecuta consultas select", async () => {
    await ejecutar({}, CI);
    expect(consultas.length).toBeGreaterThan(0);
    for (const q of consultas) expect(q.trim()).toMatch(/^select\b/i);
    expect(consultas.join("\n")).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s|grant\s|revoke\s|create\s|drop\s)/i);
  });

  it("--detalle con GITHUB_ACTIONS o CI se niega con 64 sin consultar nada", async () => {
    for (const entorno of [{ GITHUB_ACTIONS: "true" }, { CI: "1" }] as Record<string, string>[]) {
      const r = await ejecutar({ tabla: 1 }, entorno, ["--detalle"]);
      expect(r.codigo).toBe(64);
    }
    expect(consultas).toEqual([]);
  });

  it("sin CI, --detalle consulta también el detalle", async () => {
    const r = await ejecutar({ tabla: 1 }, {}, ["--detalle"]);
    expect(r.codigo).toBe(1);
    expect(consultas.length).toBe(2);
  });

  it("el job de CI lo ejecuta tras aplicar las migraciones", () => {
    const ci = readFileSync(path.resolve(import.meta.dirname, "../../.github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/run: bash scripts\/aplicar-migraciones-reales\.sh[\s\S]*?run: bash scripts\/verificar-privilegios-reales\.sh/);
  });
});
