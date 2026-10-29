import type { NextConfig } from "next";

// Producto de uso personal y familiar (sin-afiliacion.ts): ninguna ruta se
// indexa, incluidas /guia, /terminos y /privacidad -pese a ser pública y sin sesión, dice que el
// acceso está limitado a los correos autorizados de una familia, que es
// dato personal (guia-ac7.d). Va aquí y no en middleware.ts porque el
// matcher de éste excluye a propósito esas páginas de su procesamiento.
const nextConfig: NextConfig = {
  // lam-ac4: las fuentes se leen con fs, que el trazado de Vercel no ve solo.
  outputFileTracingIncludes: {
    "/api/plan/[id]/infografia.png": ["./assets/fuentes/**"],
  },
  // Vercel corre Linux x64 con glibc: sharp carga el binario nativo de esa
  // plataforma y nunca llega a las variantes musl ni a la de WebAssembly, que
  // sumaban ~27 MB a cada función que traza sharp.
  outputFileTracingExcludes: {
    "/*": [
      "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
      "./node_modules/@img/sharp-linuxmusl-x64/**",
      "./node_modules/@img/sharp-wasm32/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // Un sw.js cacheado por el navegador o por un intermediario dejaría
      // código viejo vivo tras un push a dev.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
