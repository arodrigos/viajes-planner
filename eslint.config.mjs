import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores de eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // map-ac1: copia generada del worker de maplibre-gl
    // (scripts/copiar-worker-maplibre.mjs), minificada y de un tercero -no
    // es código del repo, ignorada igual que .next/**.
    "public/maplibre/**",
  ]),
]);

export default eslintConfig;
