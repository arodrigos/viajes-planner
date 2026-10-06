"use client";

import { useId, useState } from "react";

// Por debajo de este largo el consejo cabe en 4 líneas a 360 px: sin botón.
export const UMBRAL_VER_MAS = 280;

// cc-ac2: el texto completo está siempre en el DOM; el recorte es solo CSS
// (line-clamp), así un lector de pantalla lo lee entero aunque se vea
// plegado.
export function ConsejoGuia({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const largo = texto.length > UMBRAL_VER_MAS;
  return (
    <>
      <p id={id} className={`texto-guia consejo-guia${largo && !abierto ? " consejo-recortado" : ""}`} data-testid="consejo-guia">
        {texto}
      </p>
      {largo && (
        <button type="button" className="boton-ver-mas" aria-expanded={abierto} aria-controls={id} onClick={() => setAbierto((v) => !v)}>
          {abierto ? "Ver menos" : "Ver más"}
        </button>
      )}
    </>
  );
}
