"use client";

import { useState } from "react";
import { IconoSinFoto } from "./iconoSinFoto";

interface Props {
  src: string;
  alt: string;
  className: string;
  width?: number;
  height?: number;
  // La atribución vive fuera de este componente: sin foto no hay nada que atribuir.
  alFallar?: () => void;
}

// crossOrigin: el SW solo puede guardar la foto como respuesta legible (no
// opaca) si se pide con CORS. Cualquier error de carga es una foto que nunca
// se vio: el marcador de siempre, no un icono roto. No se mira navigator.onLine
// porque con cobertura pero sin datos vale true y la foto falla igualmente
// (#272, #274, #277).
export function FotoPlan({ src, alt, className, width, height, alFallar }: Props) {
  const [ausente, setAusente] = useState(false);
  if (ausente) {
    return (
      <div className="foto-ausente" role="img" aria-label="Foto no disponible sin conexión" data-foto-estado="no-disponible">
        <IconoSinFoto />
        <span>Foto no disponible sin conexión</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      crossOrigin="anonymous"
      className={className}
      width={width}
      height={height}
      onError={() => {
        setAusente(true);
        alFallar?.();
      }}
    />
  );
}
