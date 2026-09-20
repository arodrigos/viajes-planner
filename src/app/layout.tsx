import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viajes",
  description: "Planificador de viajes turísticos personal y familiar",
};

// Sin esto, un móvil renderiza la página a un ancho de viewport virtual
// (normalmente 980px) y la reduce con zoom: todo se ve diminuto y "no
// desbordar" deja de significar nada, porque el desbordamiento ya no
// existe a esa escala falsa.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
