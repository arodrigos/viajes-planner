"use client";

import { useEffect, useState } from "react";
import { existeCopia } from "@/lib/sinConexion/guardados";
import { formatearHora, textoAviso } from "@/lib/sinConexion/reglas";

export function FranjaCopia({ leidoEn }: { leidoEn: string }) {
  return (
    <p role="status" className="franja-copia">
      {textoAviso(new Date(leidoEn))}
    </p>
  );
}

// En Safari de iPhone la copia no está en la app instalada: sin standalone, el
// usuario tiene que abrir el plan una vez desde la app antes de viajar.
function esIosSinInstalar(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios && (navigator as Navigator & { standalone?: boolean }).standalone === false;
}

async function copiaDisponible(planId: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return false;
  return existeCopia(planId);
}

// Solo afirma «Disponible sin conexión» cuando la copia está de verdad en la
// caché de este dispositivo y un SW la sirve: sin SW no promete nada. La
// escritura en caché es posterior a la respuesta, así que se sondea el estado
// real con un tope en vez de suponerlo.
export function EstadoCopia({ planId, leidoEn }: { planId: string; leidoEn: string }) {
  const [disponible, setDisponible] = useState(false);

  useEffect(() => {
    let vivo = true;
    let intentos = 0;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    async function comprobar() {
      const hay = await copiaDisponible(planId).catch(() => false);
      if (!vivo) return;
      if (hay) setDisponible(true);
      else if (++intentos < 30) temporizador = setTimeout(comprobar, 500);
    }
    void comprobar();
    return () => {
      vivo = false;
      clearTimeout(temporizador);
    };
  }, [planId, leidoEn]);

  if (!disponible) return null;
  return (
    <p className="ayuda estado-copia">
      Disponible sin conexión · guardado a las {formatearHora(new Date(leidoEn))}
      {esIosSinInstalar() && ". En iPhone, ábrelo una vez desde la app instalada antes de viajar"}
    </p>
  );
}
