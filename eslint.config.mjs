import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Misma severidad que trae eslint-config-next; solo se le enseña que el
    // prefijo «_» marca un campo descartado a propósito al desestructurar.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
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
    // pwa-ac2: worker generado por `serwist build`.
    "public/sw.js",
  ]),
]);

export default eslintConfig;
