"use client";

import { useState } from "react";

export const AYUDA_INFOGRAFIA = "Una imagen del viaje entero para guardar o compartir";
export const ERROR_INFOGRAFIA = "No hemos podido preparar la imagen; inténtalo de nuevo";

interface Props {
  planId: string;
}

// inf-ac3: con navigator.share y soporte de ficheros se comparte; cancelar el
// diálogo (AbortError) no es un fallo y no enseña nada.
export function BotonInfografia({ planId }: Props) {
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function pulsar() {
    setError(false);
    setCargando(true);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/infografia.png`);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const fichero = new File([await respuesta.blob()], "infografia-viaje.png", { type: "image/png" });
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [fichero] })) {
        try {
          await navigator.share({ files: [fichero], title: "Mi viaje" });
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError")) throw e;
        }
        return;
      }
      const url = URL.createObjectURL(fichero);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = fichero.name;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button type="button" aria-describedby="ayuda-infografia" disabled={cargando} onClick={pulsar}>
        Descargar infografía
      </button>
      <p id="ayuda-infografia" className="ayuda">
        {AYUDA_INFOGRAFIA}
      </p>
      {error && <p role="alert">{ERROR_INFOGRAFIA}</p>}
    </>
  );
}
