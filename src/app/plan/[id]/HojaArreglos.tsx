"use client";

import { useEffect, useRef } from "react";
import type { ArregloPropuesto } from "@/lib/plan/arreglos";
import { TEXTOS_ARREGLOS } from "@/lib/textos/arreglos";
import type { Arreglos } from "./useArreglos";

// Hoja que sube desde abajo con las opciones para una parada en conflicto. El
// foco entra en ella al abrirse y Escape la cierra sin tocar nada.
export function HojaArreglos({ nombreParada, opciones, onElegir, onCerrar }: { nombreParada: string; opciones: ArregloPropuesto[]; onElegir: (arreglo: ArregloPropuesto) => void; onCerrar: () => void }) {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titulo.current?.focus();
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);
  return (
    <div className="hoja-arreglos-fondo" data-testid="hoja-arreglos-fondo" onClick={onCerrar}>
      <div className="hoja-arreglos" role="dialog" aria-modal="true" aria-labelledby="titulo-hoja-arreglos" data-testid="hoja-arreglos" onClick={(e) => e.stopPropagation()}>
        <h2 id="titulo-hoja-arreglos" ref={titulo} tabIndex={-1}>
          {TEXTOS_ARREGLOS.tituloHoja.texto.replace("{parada}", nombreParada)}
        </h2>
        {opciones.length === 0 ? (
          <p data-testid="hoja-sin-opciones">{TEXTOS_ARREGLOS.sinOpciones.texto}</p>
        ) : (
          <ul className="pila">
            {opciones.map((o, i) => (
              <li key={`${o.tipo}-${i}`}>
                <button type="button" className="boton" data-testid={`arreglo-${o.tipo}`} onClick={() => onElegir(o)}>
                  {o.etiqueta}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="boton" data-testid="arreglo-dejarla" onClick={onCerrar}>
          {TEXTOS_ARREGLOS.dejarla.texto}
        </button>
      </div>
    </div>
  );
}

export function AvisoArreglo({ arreglos }: { arreglos: Arreglos }) {
  return (
    <div className="aviso-orden-vivo aviso-arreglo-vivo" role="status" aria-live="polite" data-testid="aviso-arreglo">
      {arreglos.error ? (
        <div className="aviso-orden aviso-orden-error">
          <span>{arreglos.error}</span>
        </div>
      ) : (
        arreglos.aviso && (
          <div className="aviso-orden">
            <span>{arreglos.aviso.conDeshacer ? `${arreglos.aviso.texto} · ` : arreglos.aviso.texto}</span>
            {arreglos.aviso.conDeshacer && (
              <button type="button" className="boton" onClick={arreglos.deshacer} disabled={arreglos.ocupado}>
                {TEXTOS_ARREGLOS.deshacer.texto}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
