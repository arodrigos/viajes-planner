"use client";

import type { OrdenDia } from "./useOrdenDia";

// Aviso fijo abajo con región viva: confirma el guardado, ofrece Deshacer y,
// si falla, deja «Reintentar» para volver a mandar el mismo orden.
export function AvisoOrden({ orden }: { orden: OrdenDia }) {
  const hayError = orden.estado === "error" && orden.mensaje;
  if (!orden.aviso && !hayError) return <div className="aviso-orden-vivo" role="status" aria-live="polite" />;
  return (
    <div className="aviso-orden-vivo" role="status" aria-live="polite">
      {hayError ? (
        <div className="aviso-orden aviso-orden-error">
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
