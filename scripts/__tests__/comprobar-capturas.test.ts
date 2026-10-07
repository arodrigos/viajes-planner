import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(import.meta.dirname, "../comprobar-capturas.mjs");

const DECLARADAS = [
  { bloque: "bloque-a", fichero: "uno.png" },
  { bloque: "bloque-a", fichero: "dos.png" },
  { bloque: "bloque-b", fichero: "tres.png" },
];

let temporal: string;

function ejecutar() {
  return spawnSync(process.execPath, [SCRIPT, "--dir", path.join(temporal, "capturas"), "--lista", path.join(temporal, "lista.mjs")], {
    encoding: "utf8",
  });
}

function crear({ bloque, fichero }: { bloque: string; fichero: string }) {
  mkdirSync(path.join(temporal, "capturas", bloque), { recursive: true });
  writeFileSync(path.join(temporal, "capturas", bloque, fichero), "png");
}

beforeEach(() => {
  temporal = mkdtempSync(path.join(tmpdir(), "capturas-"));
  writeFileSync(path.join(temporal, "lista.mjs"), `export const CAPTURAS_ESPERADAS = ${JSON.stringify(DECLARADAS)};`);
});

afterEach(() => rmSync(temporal, { recursive: true, force: true }));

describe("comprobar-capturas", () => {
  it("falla nombrando bloque y fichero cuando falta una de las tres declaradas", () => {
    crear(DECLARADAS[0]);
    crear(DECLARADAS[1]);
    const resultado = ejecutar();
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain("bloque-b");
    expect(resultado.stderr).toContain("tres.png");
    expect(resultado.stderr).not.toContain("uno.png");
  });

  it("sale con 0 cuando están las tres", () => {
    DECLARADAS.forEach(crear);
    expect(ejecutar().status).toBe(0);
  });

  it("no da por buena una captura que está en otro bloque", () => {
    crear(DECLARADAS[0]);
    crear(DECLARADAS[1]);
    crear({ bloque: "bloque-a", fichero: "tres.png" });
    const resultado = ejecutar();
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain("bloque-b");
  });
});
