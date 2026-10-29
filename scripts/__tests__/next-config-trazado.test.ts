import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config: trazado de funciones", () => {
  it("conserva las fuentes de la infografía, que se leen con fs", () => {
    expect(nextConfig.outputFileTracingIncludes?.["/api/plan/[id]/infografia.png"]).toContain(
      "./assets/fuentes/**",
    );
  });

  it("excluye de todas las rutas las variantes de sharp que Vercel no usa", () => {
    const excluidos = nextConfig.outputFileTracingExcludes?.["/*"] ?? [];
    expect(excluidos).toEqual(
      expect.arrayContaining([
        "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
        "./node_modules/@img/sharp-linuxmusl-x64/**",
        "./node_modules/@img/sharp-wasm32/**",
      ]),
    );
    // El binario glibc x64 es el que carga Vercel: nunca se excluye.
    expect(excluidos.some((g) => /sharp-(libvips-)?linux-x64/.test(g))).toBe(false);
  });
});
