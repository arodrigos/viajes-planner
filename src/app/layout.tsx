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
//
// viajes-ac1: «Mis viajes» va en el mismo pie, presente en todas las
// páginas -es el «acceso visible, sin teclear ninguna dirección» que pide
// el criterio, y /viajes resuelve sin sesión con su propio panel de acceso.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <footer>
          <Link href="/viajes">Mis viajes</Link>
          <Link href="/guia">Guía: cómo funciona esta aplicación</Link>
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
        </footer>
      </body>
    </html>
  );
}
