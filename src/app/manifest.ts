import type { MetadataRoute } from "next";

// Colores de globals.css (--background y --foco): el manifiesto no puede leer
// variables CSS, así que se repiten aquí.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Viajes",
    short_name: "Viajes",
    description: "Planificador de viajes turísticos personal y familiar",
    start_url: "/viajes",
    scope: "/",
    display: "standalone",
    lang: "es",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/iconos/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/iconos/icono-512.png", sizes: "512x512", type: "image/png" },
      { src: "/iconos/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
