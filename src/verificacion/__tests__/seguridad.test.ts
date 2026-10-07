import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUTA_PLAN, RUTA_SESION } from "../entorno";

// ver-ac5: el repo es público y la suite maneja credenciales de un usuario.
describe("verificación con sesión no filtra credenciales ni infraestructura", () => {
  it("la documentación no nombra infraestructura, rutas de máquina ni correos", () => {
    const doc = readFileSync("docs/verificacion-con-sesion.md", "utf8");
    expect(doc).not.toMatch(/vps|tailscale|\/home\/|@/i);
  });

  it("la sesión y el plan guardados quedan en una ruta que git ignora", () => {
    for (const ruta of [RUTA_SESION, RUTA_PLAN]) {
      expect(() => execFileSync("git", ["check-ignore", "-q", ruta])).not.toThrow();
    }
  });

  it("ninguna spec ni ayuda imprime las variables de acceso", () => {
    const dir = join(__dirname, "..");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const codigo = readFileSync(join(dir, f), "utf8");
      const imprime = /(console\.(log|info|warn|error)|annotations\.push|attach)\([^)]*(CORREO_ACCESO|CODIGO_ACCESO)/;
      expect(codigo, f).not.toMatch(imprime);
    }
  });
});
