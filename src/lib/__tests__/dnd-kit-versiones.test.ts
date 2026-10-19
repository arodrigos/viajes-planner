import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// arr-ac3: una versión que se mueve por debajo cambiaría el arrastre sin un commit nuestro.
const leer = (ruta: string) => JSON.parse(readFileSync(ruta, "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("versiones fijadas de @dnd-kit", () => {
  const paquetes = ["@dnd-kit/react", "@dnd-kit/helpers"];

  it.each(paquetes)("package.json declara %s en 0.5.1 exacto, sin ^ ni ~", (nombre) => {
    expect(leer("package.json").dependencies[nombre]).toBe("0.5.1");
  });

  it.each(paquetes)("package-lock.json resuelve %s en 0.5.1", (nombre) => {
    const lock = leer("package-lock.json");
    expect(lock.packages[`node_modules/${nombre}`].version).toBe("0.5.1");
    expect(lock.packages[""].dependencies[nombre]).toBe("0.5.1");
  });
});
