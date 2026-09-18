import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viajes",
  description: "Planificador de viajes turísticos personal y familiar",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
