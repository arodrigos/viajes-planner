"use client";

import { useState } from "react";
import { IconoSinFoto } from "./iconoSinFoto";

interface Props {
  src: string;
  alt: string;
  className: string;
  width?: number;
  height?: number;
}

// crossOrigin: el SW solo puede guardar la foto como respuesta legible (no
// opaca) si se pide con CORS. Si falla estando sin red es una foto que nunca
// se vio: el marcador de siempre, no un icono roto. Con red se deja como
// estaba, para no ocultar un fallo real del CDN.
export function FotoPlan({ src, alt, className, width, height }: Props) {
  const [ausente, setAusente] = useState(false);
  if (ausente) {
    return (
      <div className="foto-ausente">
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
        if (!navigator.onLine) setAusente(true);
      }}
    />
  );
}
