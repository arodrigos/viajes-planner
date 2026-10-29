import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRESUPUESTO } from "../comprobar-presupuesto-despliegue.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../comprobar-presupuesto-despliegue.mjs");
const carpetas: string[] = [];

function correr(contenido: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "presupuesto-"));
  carpetas.push(dir);
  const informe = path.join(dir, "informe.json");
  writeFileSync(informe, contenido);
  return spawnSync("node", [SCRIPT, informe], { encoding: "utf8" });
}

afterEach(() => {
  while (carpetas.length) rmSync(carpetas.pop()!, { recursive: true, force: true });
});

describe("comprobar-presupuesto-despliegue", () => {
  it("pasa con el despliegue actual (39 funciones, 100,55 MB)", () => {
    const r = correr(JSON.stringify({ funciones: 39, total_mb: 100.55 }));
    expect(r.status).toBe(0);
  });

  it("pasa justo en el límite", () => {
    expect(correr(JSON.stringify({ funciones: PRESUPUESTO.funciones, total_mb: PRESUPUESTO.total_mb })).status).toBe(0);
  });

  it("falla y dice qué superó si pasa de MB", () => {
    const r = correr(JSON.stringify({ funciones: 39, total_mb: 151 }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("total_mb");
    expect(r.stderr).not.toContain("funciones:");
  });

  it("falla y dice qué superó si pasa de funciones", () => {
    const r = correr(JSON.stringify({ funciones: 41, total_mb: 100 }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("funciones: 41 > 40");
  });

  it("falla con un informe ilegible o incompleto", () => {
    expect(correr("no es json").status).toBe(1);
    expect(correr("{}").status).toBe(1);
  });
});
