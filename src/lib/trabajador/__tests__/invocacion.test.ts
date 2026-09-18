import { afterEach, describe, expect, it, vi } from "vitest";
import { construirInvocacion } from "@/lib/trabajador/invocacion";

const NOMBRES_SECRETO = /KEY|SECRET|TOKEN|PASSWORD/i;

describe("construirInvocacion (trabajador-ac3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no incluye ninguna herramienta de ejecución ni ningún --add-dir fuera del directorio", () => {
    const invocacion = construirInvocacion("hola", { directorio: "/tmp/trabajo-1", modelo: "claude-sonnet-5" });

    expect(invocacion.argumentos).not.toContain("--add-dir");
    expect(invocacion.argumentos.join(" ")).not.toMatch(/bash|execute|shell/i);
    const indiceHerramientas = invocacion.argumentos.indexOf("--allowedTools");
    expect(indiceHerramientas).toBeGreaterThanOrEqual(0);
    const herramientas = invocacion.argumentos[indiceHerramientas + 1].split(",");
    expect(herramientas).toEqual(["Read", "Write"]);
  });

  it("el cwd es exactamente el directorio de trabajo recibido, nunca otro", () => {
    const invocacion = construirInvocacion("hola", { directorio: "/tmp/trabajo-2", modelo: "claude-sonnet-5" });
    expect(invocacion.cwd).toBe("/tmp/trabajo-2");
  });

  it("el entorno de la invocación no contiene ningún nombre de secreto conocido", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "clave-de-prueba");
    vi.stubEnv("OPENROUTESERVICE_API_KEY", "clave-de-prueba");
    vi.stubEnv("MAPTILER_API_KEY", "clave-de-prueba");
    vi.stubEnv("CRON_SECRET", "clave-de-prueba");
    vi.stubEnv("CORREOS_PERMITIDOS", "a@b.com");

    const invocacion = construirInvocacion("hola", { directorio: "/tmp/trabajo-3", modelo: "claude-sonnet-5" });
    const infractores = Object.keys(invocacion.entorno).filter((clave) => NOMBRES_SECRETO.test(clave));
    expect(infractores).toEqual([]);
  });
});
