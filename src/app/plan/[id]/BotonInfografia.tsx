"use client";

import { useState } from "react";

export const AYUDA_INFOGRAFIA = "Una imagen del viaje entero para guardar o compartir";
export const ERROR_INFOGRAFIA = "No hemos podido preparar la imagen; inténtalo de nuevo";

interface Props {
  planId: string;
  version: number;
}

// inf-ac3: con navigator.share y soporte de ficheros se comparte; cancelar el
// diálogo (AbortError) no es un fallo y no enseña nada.
export function BotonInfografia({ planId, version }: Props) {
  const [abierta, setAbierta] = useState(false);
  // Una vez pedida, la figura se queda montada y solo se oculta: cerrar y abrir no repite la petición.
  const [pedida, setPedida] = useState(false);
  const [cargaPrevia, setCargaPrevia] = useState<"cargando" | "lista" | "error">("cargando");
  const [reintento, setReintento] = useState(0);
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

  // Nada se pide hasta abrir: cada vista regenera la lámina (no-store) y no
  // queremos gastar una función serverless en cada carga de la página. La URL
  // es same-origin, así que lleva la cookie y la guarda de la ruta no cambia.
  const src = `/api/plan/${planId}/infografia.png?v=${version}${reintento > 0 ? `&r=${reintento}` : ""}`;

  function conmutar() {
    setAbierta((a) => !a);
    setPedida(true);
  }

  function reintentar() {
    setCargaPrevia("cargando");
    setReintento((n) => n + 1);
  }

  return (
    <>
      <button type="button" aria-expanded={abierta} aria-controls="previa-infografia" onClick={conmutar}>
        Ver infografía
      </button>
      {pedida && (
        <figure id="previa-infografia" className="previa-infografia" hidden={!abierta}>
          {cargaPrevia === "cargando" && (
            <p role="status" className="previa-infografia-marcador">
              Preparando la infografía…
            </p>
          )}
          {cargaPrevia === "error" ? (
            <div role="alert" className="previa-infografia-marcador">
              <p>{ERROR_INFOGRAFIA}</p>
              <button type="button" onClick={reintentar}>
                Reintentar
              </button>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- la ruta es privada y no-store: next/image la cachearía
            <img
              key={src}
              src={src}
              alt="Infografía del viaje"
              width={1080}
              height={1350}
              onLoad={() => setCargaPrevia("lista")}
              onError={() => setCargaPrevia("error")}
              hidden={cargaPrevia === "cargando"}
            />
          )}
        </figure>
      )}
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
