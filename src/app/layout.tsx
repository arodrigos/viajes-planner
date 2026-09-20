import type { Metadata, Viewport } from "next";
import Link from "next/link";
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

// guia-ac7(a): el enlace del pie tiene que existir en las cuatro páginas
// -por eso vive en el layout raíz y no en cada page.tsx- y alcanza además
// al usuario que ya está atascado a mitad de camino, que es el caso real
// que motivó este bloque.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <footer>
          <Link href="/guia">Guía: cómo funciona esta aplicación</Link>
        </footer>
      </body>
    </html>
  );
}
