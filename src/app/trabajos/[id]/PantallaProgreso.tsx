"use client";

import { useEffect, useState } from "react";

interface EstadoTrabajo {
  estado: string;
  etapa: string | null;
  porcentaje: number;
  motivo: string | null;
  reintento_no_antes_de: string | null;
  // final-ac1: solo trae valor con estado "completado" (y no siempre, si el
  // trabajo se completó antes de esta tanda); en cualquier otro estado es
  // null.
  plan_id: string | null;
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
      <>
        <h1>Tu sesión ha caducado</h1>
        <div className="pila" role="alert">
          <p>Tu sesión ha caducado.</p>
          <p>
            Puedes volver a entrar desde <a href="/criterios">/criterios</a>; el trabajo sigue su curso y esta misma
            dirección te lo mostrará cuando vuelvas.
          </p>
        </div>
      </>
    );
  }
  if (error)
    return (
      <>
        <h1>No se ha podido consultar tu viaje</h1>
        <p role="alert">{error}</p>
      </>
    );
  if (!trabajo)
    return (
      <>
        <h1>Tu viaje</h1>
        <p>Consultando el estado del trabajo…</p>
      </>
    );

  if (trabajo.estado === "caducado") {
    return (
      <>
        <h1>El trabajo ha caducado</h1>
        <div className="pila">
          <p>El trabajo ha caducado.</p>
          <p>{trabajo.motivo}</p>
        </div>
      </>
    );
  }

  // usabilidad-ac8(b): en todo estado de espera hay que recordar que esta
  // dirección -no un botón ni una cuenta- es la única forma de volver a
  // encontrar el trabajo, porque es el error real que motivó este bloque:
  // gente cerrando la pestaña sin guardar nada.
  const avisoDireccion = (
    <div className="aviso">
      <p>Puedes cerrar esta pantalla y volver cuando quieras: esta dirección es la única forma de encontrar este trabajo, así que conviene guardarla.</p>
      {/* txt-ac2: aquí es donde el usuario podría preguntarse por qué no le
          hemos vuelto a pedir el código al volver -la respuesta es que sigue
          con la sesión que abrió al escribirlo, no que la pantalla no lo
          necesite. */}
      <p>Sigues con la sesión que iniciaste con tu código: por eso no hace falta que vuelvas a pedirlo en este navegador.</p>
    </div>
  );

  if (trabajo.estado === "encolado") {
    return (
      <>
        <h1>Tu viaje se está generando</h1>
        <div className="pila">
          <p>Tu viaje está en la cola: un agente lo va a generar en cuanto le llegue el turno, y puede tardar varios minutos.</p>
          {avisoDireccion}
        </div>
      </>
    );
  }

  if (trabajo.estado === "pausado-por-cuota") {
    return (
      <>
        <h1>Tu viaje se está generando</h1>
        <div className="pila">
          <p>El viaje está pausado, no roto: la suscripción ha llegado a su límite de uso y se retomará sola.</p>
          <p>{trabajo.motivo}</p>
          {trabajo.reintento_no_antes_de && <p>Se retomará a partir de {formatearFecha(trabajo.reintento_no_antes_de)}.</p>}
          {avisoDireccion}
        </div>
      </>
    );
  }

  if (trabajo.estado === "fallido") {
    return (
      <>
        <h1>No se ha podido generar tu viaje</h1>
        <div className="pila">
          <p>No se ha podido generar el viaje.</p>
          <p>{trabajo.motivo}</p>
        </div>
      </>
    );
  }

  // final-ac3: un trabajo completado es el final del recorrido, no otro
  // estado de espera -antes caía en la rama por defecto de más abajo y
  // seguía enseñando la barra de progreso indefinidamente, con el <h1>
  // fijo de page.tsx ("se está generando") contradiciendo el propio cuerpo
  // ("está listo"). El <h1> vive aquí, no en page.tsx, precisamente para
  // poder depender del estado: page.tsx es un Server Component y el estado
  // solo se conoce tras la consulta cliente. final-ac4: si el trabajador
  // terminó sin dejar plan_id (escritura a medias, o un trabajo completado
  // antes de esta tanda), no se fabrica un enlace roto.
  if (trabajo.estado === "completado") {
    if (!trabajo.plan_id) {
      return (
        <>
          <h1>Tu viaje ha terminado</h1>
          <div className="pila">
            <p>Tu viaje ha terminado, pero el itinerario no está disponible desde aquí ahora mismo.</p>
            <p>
              Vuelve a intentarlo recargando esta misma página en un momento; si sigue sin aparecer, genera el viaje
              de nuevo desde <a href="/criterios">/criterios</a>.
            </p>
          </div>
        </>
      );
    }
    return (
      <>
        <h1>Tu viaje está listo</h1>
        <div className="pila">
          {/* final-ac3(c): el enlace es la ACCIÓN PRINCIPAL de esta pantalla
              -mismo estilo que el CTA de la portada-, no texto corrido que
              compita en peso visual con el aviso secundario de abajo. */}
          <p>
            <a href={`/plan/${trabajo.plan_id}`} className="boton boton-principal">
              Ver el itinerario
            </a>
          </p>
          {/* El aviso deja de llevar la caja con borde destacado (`.aviso`)
              que antes se comía la atención por encima del enlace: ahora es
              una nota secundaria, con el mismo estilo de ayuda que el resto
              del producto usa para texto que no es la acción a tomar. */}
          <p className="ayuda">
            A partir de ahora la dirección que conviene guardar es la del plan, no la de esta pantalla: es la única
            forma de volver a encontrar el itinerario.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Tu viaje se está generando</h1>
      <div className="pila">
        <p>{trabajo.etapa ?? "preparando la petición"}</p>
        <progress value={trabajo.porcentaje} max={100} aria-label="Progreso de la generación" />
        {avisoDireccion}
      </div>
    </>
  );
}
