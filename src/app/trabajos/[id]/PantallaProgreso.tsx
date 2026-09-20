"use client";

import { useEffect, useState } from "react";

interface EstadoTrabajo {
  estado: string;
  etapa: string | null;
  porcentaje: number;
  motivo: string | null;
  reintento_no_antes_de: string | null;
}

const INTERVALO_MS = 3000;

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
}

// vista-ac1: el usuario ve el NOMBRE de la etapa en curso, no una barra
// genérica -es lo que Adrián pidió a cambio de aceptar más espera-, y cada
// estado que no es éxito se explica con su motivo y, cuando lo hay, con su
// hora de reanudación, en vez de seguir girando en silencio.
export function PantallaProgreso({ id }: { id: string }) {
  const [trabajo, setTrabajo] = useState<EstadoTrabajo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function consultar() {
      try {
        const respuesta = await fetch(`/api/trabajos/${id}`);
        if (!respuesta.ok) {
          if (!cancelado) setError("No se ha podido consultar el trabajo.");
          return;
        }
        const datos: EstadoTrabajo = await respuesta.json();
        if (!cancelado) setTrabajo(datos);
      } catch {
        if (!cancelado) setError("No se ha podido consultar el trabajo.");
      }
    }

    consultar();
    const intervalo = setInterval(() => {
      if (trabajo && ["completado", "fallido", "caducado"].includes(trabajo.estado)) return;
      consultar();
    }, INTERVALO_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el intervalo comprueba el estado más reciente por closure, no hace falta reiniciarlo en cada respuesta
  }, [id]);

  if (error) return <p role="alert">{error}</p>;
  if (!trabajo) return <p>Consultando el estado del trabajo…</p>;

  if (trabajo.estado === "caducado") {
    return (
      <div className="pila">
        <p>El trabajo ha caducado.</p>
        <p>{trabajo.motivo}</p>
      </div>
    );
  }

  if (trabajo.estado === "encolado") {
    return <p>Encolado, esperando a que un trabajador lo recoja…</p>;
  }

  if (trabajo.estado === "pausado-por-cuota") {
    return (
      <div className="pila">
        <p>El viaje está pausado: la suscripción ha llegado a su límite de uso.</p>
        <p>{trabajo.motivo}</p>
        {trabajo.reintento_no_antes_de && <p>Se retomará a partir de {formatearFecha(trabajo.reintento_no_antes_de)}.</p>}
      </div>
    );
  }

  if (trabajo.estado === "fallido") {
    return (
      <div className="pila">
        <p>No se ha podido generar el viaje.</p>
        <p>{trabajo.motivo}</p>
      </div>
    );
  }

  return (
    <div className="pila">
      <p>{trabajo.etapa ?? "preparando la petición"}</p>
      <progress value={trabajo.porcentaje} max={100} aria-label="Progreso de la generación" />
    </div>
  );
}
