"use client";

import { useEffect, useRef } from "react";
import { TEXTOS_ORDEN, type OrdenDia } from "./useOrdenDia";

// Aviso fijo abajo con región viva: confirma el guardado, ofrece Deshacer y,
// si falla, deja «Reintentar» para volver a mandar el mismo orden.
export function AvisoOrden({ orden }: { orden: OrdenDia }) {
  const hayError = orden.estado === "error" && orden.mensaje;
  // Que el plan se haya actualizado en otra pantalla no es un fallo de la
  // persona ni de la red: se enseña como información, no como error.
  const informativo = hayError && orden.mensaje === TEXTOS_ORDEN.desfasada;
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // "nearest": si ya se ve, la página no se mueve.
    if (informativo) caja.current?.scrollIntoView({ block: "nearest" });
  }, [informativo, orden.mensaje]);
  if (!orden.aviso && !hayError) return <div className="aviso-orden-vivo" role="status" aria-live="polite" />;
  return (
    <div className="aviso-orden-vivo" role="status" aria-live="polite">
      {hayError ? (
        <div ref={caja} className={informativo ? "aviso-orden aviso-orden-info" : "aviso-orden aviso-orden-error"}>
          <span>{orden.mensaje}</span>
          {orden.mensaje?.startsWith("No se ha podido") && (
            <button type="button" className="boton" onClick={orden.reintentar}>
              Reintentar
            </button>
          )}
        </div>
      ) : (
        orden.aviso && (
          <div className="aviso-orden">
            <span>{orden.aviso.conDeshacer ? `${orden.aviso.texto} · ` : orden.aviso.texto}</span>
            {orden.aviso.conDeshacer && (
              <button type="button" className="boton" onClick={orden.deshacer}>
                Deshacer
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
