// reco-ac4: iconos puramente decorativos -la información real la lleva el
// texto (nombre y motivo), nunca el icono-, mismo criterio que
// iconosFranja.tsx: aria-hidden="true" siempre, sin <title>.

import type { JSX } from "react";

interface PropiedadesIcono {
  className?: string;
}

function CubiertosCruzados({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <path d="M6 3v6a2 2 0 0 0 4 0V3M8 9v12" />
      <path d="M17 3c-1.5 0-3 1.5-3 4s1 4 3 6v8" />
    </svg>
  );
}

function Edificio({ className }: PropiedadesIcono) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={className}>
      <rect x="4" y="8" width="16" height="13" rx="1" />
      <path d="M9 3h6l1 5H8l1-5Z" />
      <path d="M9 21v-5h6v5" />
    </svg>
  );
}

const ICONOS_POR_TIPO_RECOMENDACION: Record<string, (props: PropiedadesIcono) => JSX.Element> = {
  comida: CubiertosCruzados,
  recinto: Edificio,
};

export function IconoRecomendacion({ tipo, className }: { tipo: string; className?: string }) {
  const Icono = ICONOS_POR_TIPO_RECOMENDACION[tipo] ?? Edificio;
  return <Icono className={className} />;
}
