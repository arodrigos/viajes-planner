import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// inv-ac4: la suite preview maneja credenciales de dos usuarios y el repo es público.
const CENTINELAS = {
  CORREO_ACCESO: "centinela-duenyo@example.invalid",
  CODIGO_ACCESO: "111222",
  CORREO_INVITADO: "centinela-invitado@example.invalid",
  CODIGO_INVITADO: "333444",
};

describe("la suite preview no vuelca credenciales", () => {
  it("el global setup, con valores centinela, los usa pero no los imprime ni los deja en ficheros", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sin-credenciales-"));
    const recibidos: string[] = [];
    // Un doble mínimo del despliegue: acepta cualquier canje y apunta lo recibido.
    const servidor = createServer((peticion, respuesta) => {
      let cuerpo = "";
      peticion.on("data", (trozo) => (cuerpo += trozo));
      peticion.on("end", () => {
        recibidos.push(cuerpo);
        respuesta.setHeader("content-type", "application/json");
        respuesta.end("{}");
      });
    });
    await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
    try {
      const { port } = servidor.address() as AddressInfo;
      // Asíncrono a propósito: un spawnSync bloquearía el servidor que atiende al hijo.
      const hijo = spawn("npx", ["tsx", "src/verificacion/__tests__/ejecutar-setup.ts"], {
        env: { ...process.env, ...CENTINELAS, URL_OBJETIVO: `http://127.0.0.1:${port}`, VERIFICACION_DIR: dir, PLAN_PRUEBA_ID: "plan-x" },
      });
      let salida = "";
      hijo.stdout.on("data", (t) => (salida += t));
      hijo.stderr.on("data", (t) => (salida += t));
      await new Promise<void>((resolver) => hijo.on("close", () => resolver()));
      expect(recibidos.some((c) => c.includes(CENTINELAS.CODIGO_ACCESO))).toBe(true);
      expect(recibidos.some((c) => c.includes(CENTINELAS.CODIGO_INVITADO))).toBe(true);
      for (const valor of Object.values(CENTINELAS)) expect(salida).not.toContain(valor);
      for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toMatch(/centinela|111222|333444/);
    } finally {
      servidor.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("ninguna spec ni ayuda imprime las variables del invitado", () => {
    const imprime = /(console\.(log|info|warn|error)|annotations\.push|attach)\([^)]*(CORREO_INVITADO|CODIGO_INVITADO)/;
    for (const f of readdirSync(join(__dirname, "..")).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(join(__dirname, "..", f), "utf8"), f).not.toMatch(imprime);
    }
    const spec = readFileSync("src/app/plan/[id]/compartir.preview.e2e.ts", "utf8");
    expect(spec).not.toMatch(imprime);
    // Las capturas del invitado y la lista «Con acceso» pasan por capturar(), que tapa los correos.
    expect(spec).not.toMatch(/\.screenshot\(/);
  });
});
