import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leerEnvSuperior } from "../entorno-workflows";

const RAIZ = path.resolve(import.meta.dirname, "../..");

function ficheros(dir: string, acepta: (nombre: string) => boolean): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" ? [] : ficheros(ruta, acepta);
    return acepta(nombre) ? [ruta] : [];
  });
}

const CORREO = /ci-test-[a-z0-9-]+@example\.com/g;
const permitidos = new Set(leerEnvSuperior(readFileSync(path.join(RAIZ, ".github/workflows/ci.yml"), "utf8"), "CORREOS_PERMITIDOS")!.split(","));

// inv-ac3: un correo que inicia sesión y no está en la lista falla en el CI con
// un 403 poco explícito. Los de las pruebas de integración que solo crean al
// usuario con la clave de servicio (usuarioDePrueba) no pasan por la lista.
describe("correos ci-test-* de las pruebas", () => {
  const e2e = ficheros(path.join(RAIZ, "src"), (n) => n.endsWith(".e2e.ts") && !n.endsWith(".preview.e2e.ts"));

  it("hay specs que revisar", () => {
    expect(e2e.length).toBeGreaterThan(40);
  });

  it("cada correo de un e2e está en CORREOS_PERMITIDOS de ci.yml", () => {
    const fuera: string[] = [];
    for (const f of e2e) {
      for (const correo of readFileSync(f, "utf8").match(CORREO) ?? []) {
        if (!permitidos.has(correo)) fuera.push(`${path.relative(RAIZ, f)}: ${correo}`);
      }
    }
    expect(fuera).toEqual([]);
  });

  it("los correos de las integraciones que canjean un código real también", () => {
    const fuera: string[] = [];
    for (const f of ficheros(path.join(RAIZ, "src"), (n) => n.endsWith(".integration.test.ts"))) {
      const texto = readFileSync(f, "utf8");
      if (!texto.includes("solicitar-codigo") && !texto.includes("verificar-codigo") && !texto.includes("verificarCodigo")) continue;
      for (const correo of texto.match(CORREO) ?? []) if (!permitidos.has(correo)) fuera.push(`${path.relative(RAIZ, f)}: ${correo}`);
    }
    expect(fuera).toEqual([]);
  });

  it("ci.yml dice que los ci-test-* son solo del CI y el doc explica la lista del preview", () => {
    expect(readFileSync(path.join(RAIZ, ".github/workflows/ci.yml"), "utf8")).toMatch(/ci-test-\* son solo de este CI/);
    const doc = readFileSync(path.join(RAIZ, "docs/verificacion-con-sesion.md"), "utf8");
    expect(doc).toContain("## Usuarios de prueba y listas de correos");
    expect(doc).toMatch(/Ningún `ci-test-\*`/);
    expect(doc).toContain("CORREO_INVITADO");
  });
});
