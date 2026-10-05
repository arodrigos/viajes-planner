import type { NextConfig } from "next";

// Producto de uso personal y familiar (sin-afiliacion.ts): ninguna ruta se
// indexa, incluida /guia -pese a ser pública y sin sesión, dice que el
// acceso está limitado a los correos autorizados de una familia, que es
// dato personal (guia-ac7.d). Va aquí y no en middleware.ts porque el
// matcher de éste excluye a propósito /guia de su procesamiento.
const nextConfig: NextConfig = {
  // lam-ac4: las fuentes se leen con fs, que el trazado de Vercel no ve solo.
  outputFileTracingIncludes: {
    "/api/plan/[id]/infografia.png": ["./assets/fuentes/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
