// maq-ac2(b): todo <svg> de este módulo es decorativo -la información real
// la lleva siempre el texto de la etiqueta de franja, nunca el icono ni el
// color-, así que cada uno lleva aria-hidden="true" y ninguno tiene <title>
// ni texto accesible propio.

import type { JSX } from "react";

interface PropiedadesIcono {
  className?: string;
}

function Sol({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function Amanecer({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="M12 16a5 5 0 0 0-5-5m5 5a5 5 0 0 1 5-5" />
      <path d="M12 3v5M4.5 8.5l1.8 1.8M19.5 8.5l-1.8 1.8" />
      <path d="M2 20h20" />
      <path d="M5 16h14" />
    </svg>
  );
}

function SolConNube({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <circle cx="8" cy="9" r="3" />
      <path d="M8 3v1.5M3.5 6.5l1 1M8 3v1.5" />
      <path d="M13 19h5a3 3 0 0 0 0-6 4.5 4.5 0 0 0-8.6-1.4A3.5 3.5 0 0 0 10 19h3Z" />
    </svg>
  );
}

function PlatoConCubierto({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <circle cx="10" cy="12" r="7" />
      <path d="M18 5v14M21 5v6a2 2 0 0 1-2 2" />
    </svg>
  );
}

function CubiertosCruzados({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="M6 3v6a2 2 0 0 0 4 0V3M8 9v12" />
      <path d="M17 3c-1.5 0-3 1.5-3 4s1 4 3 6v8" />
    </svg>
  );
}

function LunaConEstrella({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      <path d="M5 4l.7 1.6L7.3 6.3 5.7 7 5 8.6 4.3 7 2.7 6.3 4.3 5.6 5 4Z" />
    </svg>
  );
}

// Icono por franja: puramente decorativo, la etiqueta en texto de la
// cabecera de franja es lo que lleva la información (maq-ac2).
const ICONOS_POR_FRANJA: Record<string, (props: PropiedadesIcono) => JSX.Element> = {
  "manana-temprano": Amanecer,
  manana: Sol,
  comida: PlatoConCubierto,
  tarde: SolConNube,
  cena: CubiertosCruzados,
  noche: LunaConEstrella,
};

export function IconoFranja({ franjaId, className }: { franjaId: string; className?: string }) {
  const Icono = ICONOS_POR_FRANJA[franjaId] ?? Sol;
  return <Icono className={className} />;
}
