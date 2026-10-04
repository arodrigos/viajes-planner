"use client";

import { useState } from "react";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";

// man-ac3: textos exactos -- MENSAJE_NOMBRE_VACIO es el mismo literal que
// devuelve el servidor (route.ts), así que el campo vacío nunca necesita
// llegar a la red para enseñarlo.
export const MENSAJE_NOMBRE_VACIO = "Escribe el nombre de una ciudad";
export const MENSAJE_ERROR_GENERICO = "No hemos podido guardar la ciudad. Vuelve a intentarlo en un momento.";
export const AYUDA_SIN_CIUDAD = "Dinos de qué ciudad es y buscaremos sus sitios en el mapa";
export const AVISO_SIN_CIUDAD = "No hemos identificado la ciudad de este viaje";

export interface AvisoCiudadProps {
  planId: string;
  ciudad?: CiudadEfectiva;
  totalParadas: number;
  paradasUbicadas: number;
  onGuardada?: () => void;
}

// ciudad-a-mano (man-ac1/man-ac2/man-ac3): el aviso de ciudad sin
// identificar, el campo para decirla a mano y el contador «N de M sitios
// ubicados», en un componente aparte de VistaPlan.tsx para que
// avisoCiudad.test.tsx lo pruebe sin tener que montar la vista entera.
export function AvisoCiudad({ planId, ciudad, totalParadas, paradasUbicadas, onGuardada }: AvisoCiudadProps) {
  const [nombre, setNombre] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar() {
    if (nombre.trim().length === 0) {
      setMensaje(MENSAJE_NOMBRE_VACIO);
      return;
    }
    setEnviando(true);
    setMensaje(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/ciudad`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        // man-ac3: 400/429 traen un mensaje ya pensado para enseñarse tal
        // cual (route.ts); cualquier otro fallo (500, JSON roto...) es un
        // código en crudo que no se le enseña a nadie -- mensaje genérico.
        const esMensajeConocido = (respuesta.status === 400 || respuesta.status === 429) && typeof datos?.error === "string";
        setMensaje(esMensajeConocido ? datos.error : MENSAJE_ERROR_GENERICO);
        return;
      }
      setMensaje(`Buscaremos los sitios de ${nombre.trim()} en los próximos minutos`);
      onGuardada?.();
    } catch {
      setMensaje(MENSAJE_ERROR_GENERICO);
    } finally {
      setEnviando(false);
    }
  }

  const sinIdentificar = ciudad?.estado === "sin-ciudad-identificable";
  const pendiente = ciudad?.estado === "pendiente-manual";

  return (
    <div className="pila">
      {sinIdentificar && (
        <div className="aviso" role="alert">
          <p>{AVISO_SIN_CIUDAD}</p>
          {ciudad?.motivo && <p>{ciudad.motivo}</p>}
          <p className="ayuda">{AYUDA_SIN_CIUDAD}</p>
        </div>
      )}

      {/* man-ac2 (límites): mientras está en pendiente-manual, la vista NO
          vuelve a pedir la ciudad -- solo dice que la búsqueda está en
          marcha; el campo reaparece si el siguiente tick falla y el
          estado vuelve a sin-ciudad-identificable. */}
      {pendiente && (
        <div className="aviso">
          <p>Estamos buscando los sitios de «{ciudad?.nombre_pedido}»; tardamos unos minutos.</p>
        </div>
      )}

      {sinIdentificar && (
        <div className="fila">
          <label htmlFor="ciudad-a-mano">¿De qué ciudad es este viaje?</label>
          <input id="ciudad-a-mano" type="text" value={nombre} onChange={(evento) => setNombre(evento.target.value)} disabled={enviando} />
          <button type="button" onClick={() => void guardar()} disabled={enviando}>
            Guardar ciudad
          </button>
        </div>
      )}

      {mensaje && <p role="status">{mensaje}</p>}

      <p>
        {totalParadas === 0 ? "Este viaje todavía no tiene sitios" : `${paradasUbicadas} de ${totalParadas} sitios ubicados`}
      </p>
    </div>
  );
}
