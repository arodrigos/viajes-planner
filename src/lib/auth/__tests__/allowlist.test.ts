import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ConfiguracionCorreosPermitidosVacia, correoPermitido, correosPermitidos } from "@/lib/auth/allowlist";

describe("correosPermitidos", () => {
  it("parsea una lista separada por comas, sin espacios y en minúsculas", () => {
    expect(correosPermitidos(" Ana@Ej.com , bruno@ej.com ")).toEqual(["ana@ej.com", "bruno@ej.com"]);
  });

  it("lanza ConfiguracionCorreosPermitidosVacia si está vacía o no definida", () => {
    expect(() => correosPermitidos("")).toThrow(ConfiguracionCorreosPermitidosVacia);
    expect(() => correosPermitidos(undefined)).toThrow(ConfiguracionCorreosPermitidosVacia);
  });
});

describe("correoPermitido", () => {
  const lista = "ana@ej.com,bruno@ej.com";

  it("acepta un correo de la lista", () => {
    expect(correoPermitido("ana@ej.com", lista)).toBe(true);
  });

  it("rechaza un correo fuera de la lista", () => {
    expect(correoPermitido("intruso@otro.com", lista)).toBe(false);
  });
});

describe("scripts/comprobar-entorno.ts (acceso-ac2, arranque)", () => {
  it("termina con código distinto de cero y nombra la variable cuando la lista está vacía", () => {
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/comprobar-entorno.ts"], {
        env: { ...process.env, CORREOS_PERMITIDOS: "" },
        stdio: "pipe",
      }),
    ).toThrowError(/CORREOS_PERMITIDOS/);
  });

  it("termina con código cero cuando la lista tiene al menos un correo", () => {
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/comprobar-entorno.ts"], {
        env: { ...process.env, CORREOS_PERMITIDOS: "ana@ej.com" },
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
