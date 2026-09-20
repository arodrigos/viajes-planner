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
  const [sesionCaducada, setSesionCaducada] = useState(false);

  useEffect(() => {
    let cancelado = false;

    async function consultar() {
      try {
        const respuesta = await fetch(`/api/trabajos/${id}`);
        if (!respuesta.ok) {
          if (cancelado) return;
          // acceso-ac6(d): el middleware renueva la sesión en cada
          // navegación, pero esta pantalla vive minutos u horas sin
          // recargar -si aun así el token muere, decirlo en vez de repetir
          // el genérico "no se ha podido consultar", que no explica nada.
          if (respuesta.status === 401) setSesionCaducada(true);
          // usabilidad-ac8(c): el mensaje no puede reducirse al código HTTP
          // ni a "Error:" -el usuario no sabe qué significa un 500- y tiene
          // que ofrecer una salida real, no solo constatar el fallo.
          else setError("No se ha podido consultar el trabajo. Vuelve a intentarlo en un momento; esta misma dirección seguirá funcionando.");
          return;
        }
        const datos: EstadoTrabajo = await respuesta.json();
        if (!cancelado) setTrabajo(datos);
      } catch {
        if (!cancelado)
          setError(
            "No se ha podido consultar el trabajo: revisa tu conexión y vuelve a intentarlo. Esta misma dirección seguirá funcionando cuando la recuperes.",
          );
      }
    }

    consultar();
    const intervalo = setInterval(() => {
      if (sesionCaducada) return;
      if (trabajo && ["completado", "fallido", "caducado"].includes(trabajo.estado)) return;
      consultar();
    }, INTERVALO_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el intervalo comprueba el estado más reciente por closure, no hace falta reiniciarlo en cada respuesta
  }, [id]);

  if (sesionCaducada) {
    return (
      <div className="pila" role="alert">
        <p>Tu sesión ha caducado.</p>
        <p>
          Puedes volver a entrar desde <a href="/criterios">/criterios</a>; el trabajo sigue su curso y esta misma
          dirección te lo mostrará cuando vuelvas.
        </p>
      </div>
    );
  }
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

  // usabilidad-ac8(b): en todo estado de espera hay que recordar que esta
  // dirección -no un botón ni una cuenta- es la única forma de volver a
  // encontrar el trabajo, porque es el error real que motivó este bloque:
  // gente cerrando la pestaña sin guardar nada.
  const avisoDireccion = (
    <div className="aviso">
      <p>Puedes cerrar esta pantalla y volver cuando quieras: esta dirección es la única forma de encontrar este trabajo, así que conviene guardarla.</p>
    </div>
  );

  if (trabajo.estado === "encolado") {
    return (
      <div className="pila">
        <p>Tu viaje está en la cola: un agente lo va a generar en cuanto le llegue el turno, y puede tardar varios minutos.</p>
        {avisoDireccion}
      </div>
    );
  }

  if (trabajo.estado === "pausado-por-cuota") {
    return (
      <div className="pila">
        <p>El viaje está pausado, no roto: la suscripción ha llegado a su límite de uso y se retomará sola.</p>
        <p>{trabajo.motivo}</p>
        {trabajo.reintento_no_antes_de && <p>Se retomará a partir de {formatearFecha(trabajo.reintento_no_antes_de)}.</p>}
        {avisoDireccion}
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
      {avisoDireccion}
    </div>
  );
}
