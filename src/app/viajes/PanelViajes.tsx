"use client";

import { useEffect, useState } from "react";
import { TEXTOS_VIAJES as T } from "@/lib/textos/viajes";
import { esViajePasado, hoyLocalISO } from "@/lib/viajes/clasificar";
import { PanelAcceso } from "../criterios/PanelAcceso";

interface ViajeListado {
  id: string;
  destino: string;
  fecha: string;
  fecha_fin: string | null;
  estado: string;
  plan_id: string | null;
}

export function PanelViajes() {
  const [viajes, setViajes] = useState<ViajeListado[] | null>(null);
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [necesitaAcceso, setNecesitaAcceso] = useState(false);
  const [recargaId, setRecargaId] = useState(0);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [errorEliminarId, setErrorEliminarId] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const respuesta = await fetch("/api/viajes");
        if (cancelado) return;
        if (respuesta.status === 401) {
          setNecesitaAcceso(true);
          return;
        }
        if (!respuesta.ok) {
          setError(T.errorCarga.texto);
          return;
        }
        const datos: { correo: string; viajes: ViajeListado[] } = await respuesta.json();
        if (cancelado) return;
        setError(null);
        setNecesitaAcceso(false);
        setCorreo(datos.correo);
        setViajes(datos.viajes);
      } catch {
        if (!cancelado) setError(T.errorCarga.texto);
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [recargaId]);

  // viajes-ac5: cierre de sesión real (no solo borrar estado local); tras el
  // POST, /api/viajes ya responde 401 -se vuelve a "pidiendo-acceso"
  // directamente en vez de esperar a un recargar() que llegaría a la misma
  // conclusión con una petición de más.
  async function cerrarSesion() {
    setCerrandoSesion(true);
    try {
      await fetch("/api/auth/cerrar-sesion", { method: "POST" });
    } finally {
      setCerrandoSesion(false);
      setViajes(null);
      setNecesitaAcceso(true);
    }
  }

  // borrar-ac1: sin confirmar no desaparece nada -- este handler solo se
  // invoca desde el botón del segundo paso, nunca del primer "Eliminar".
  // borrar-ac2/ac3: el borrado real lo hace el servidor (marcado, filtrado
  // por sesión); aquí solo se refleja el resultado en la lista local.
  async function eliminarViaje(id: string) {
    setEliminandoId(id);
    setErrorEliminarId(null);
    try {
      const respuesta = await fetch(`/api/viajes/${id}`, { method: "DELETE" });
      if (!respuesta.ok) {
        setErrorEliminarId(id);
        return;
      }
      setViajes((actuales) => (actuales ?? []).filter((v) => v.id !== id));
      setConfirmandoId(null);
    } catch {
      setErrorEliminarId(id);
    } finally {
      setEliminandoId(null);
    }
  }

  if (necesitaAcceso) {
    return (
      <PanelAcceso
        onVerificado={() => {
          setNecesitaAcceso(false);
          setRecargaId((n) => n + 1);
        }}
      />
    );
  }

  // viajes-ac4: el error se distingue del estado vacío -nunca una lista en
  // blanco indistinguible de "no hay viajes".
  // txt-ac4: el error dice qué hacer y trae su botón para hacerlo.
  if (error) {
    return (
      <div className="pila">
        <p role="alert">{error}</p>
        <p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setRecargaId((n) => n + 1);
            }}
          >
            {T.reintentar.texto}
          </button>
        </p>
      </div>
    );
  }

  if (!viajes) return <p>{T.cargando.texto}</p>;

  const hoy = hoyLocalISO(new Date());
  const proximos = viajes.filter((v) => !esViajePasado(v.fecha_fin, hoy));
  const pasados = viajes.filter((v) => esViajePasado(v.fecha_fin, hoy));

  const tarjetaViaje = (viaje: ViajeListado) => {
    // viajes-ac1: completado enlaza a su plan; cualquier otro estado
    // (encolado, en-curso, pausado, fallido, caducado) enlaza a la
    // pantalla de progreso, que ya sabe explicar cada uno de ellos.
    const enlace =
      viaje.estado === "completado" && viaje.plan_id
        ? { href: `/plan/${viaje.plan_id}`, texto: T.verItinerario.texto }
        : { href: `/trabajos/${viaje.id}`, texto: T.verProgreso.texto };
    return (
      <li key={viaje.id} className="tarjeta-parada pila">
        <div>
          <strong>{viaje.destino}</strong>
          <p>{viaje.fecha}</p>
          <p className="ayuda">{viaje.estado}</p>
        </div>

        {confirmandoId === viaje.id ? (
          // borrar-ac4: nombra el viaje, dice lo que va a pasar y no
          // promete papelera ni recuperación; cancelar (autoFocus) es
          // la salida por defecto.
          // peso-ac2: «Cancelar» conserva el estilo neutro por
          // defecto -es la salida segura, no lleva marca de peligro-
          // y «Eliminar de verdad» pasa a `.boton-peligro` (relleno),
          // para que los dos dejen de compartir exactamente el mismo
          // estilo computado.
          <div className="aviso" role="alertdialog" aria-label={`Eliminar viaje a ${viaje.destino}`}>
            <p>
              Vas a eliminar el viaje a <strong>{viaje.destino}</strong>. Dejarás de verlo y de poder
              abrirlo, y no se puede deshacer desde la aplicación.
            </p>
            <div className="fila">
              <button type="button" autoFocus onClick={() => setConfirmandoId(null)}>
                {T.cancelar.texto}
              </button>
              <button
                type="button"
                className="boton-peligro"
                onClick={() => void eliminarViaje(viaje.id)}
                disabled={eliminandoId === viaje.id}
              >
                {eliminandoId === viaje.id ? T.eliminando.texto : T.eliminarDeVerdad.texto}
              </button>
            </div>
            {errorEliminarId === viaje.id && <p role="alert">{T.errorEliminar.texto}</p>}
          </div>
        ) : (
          // peso-ac1: el enlace principal pasa a `.boton-principal`
          // (el mismo énfasis que ya usa `button[type="submit"]`) y
          // «Eliminar» pasa a `.accion-peligro` -color y borde de
          // peligro, sin relleno, para no competir en peso visual
          // con la acción principal de la misma fila-.
          <div className="fila">
            <a href={enlace.href} className="boton boton-principal">
              {enlace.texto}
            </a>
            <button type="button" className="accion-peligro" onClick={() => setConfirmandoId(viaje.id)}>
              {T.eliminar.texto}
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="pila">
      <div className="fila">
        {/* viajes-ac4: texto de ayuda que aclara de qué cuenta es la lista. */}
        <p className="ayuda">Estos son los viajes de la cuenta ligada a {correo}.</p>
        <button type="button" onClick={() => void cerrarSesion()} disabled={cerrandoSesion}>
          {cerrandoSesion ? T.cerrandoSesion.texto : T.cerrarSesion.texto}
        </button>
      </div>

      {/* otro-ac1: solo en la rama con viajes -el estado vacío ya tiene su
          propio enlace a /criterios ("Cuéntanos tu viaje") y duplicarlo
          sería un segundo camino, justo lo que el diseño prohíbe (otro-ac3).
          Va ANTES del <ul>, para que se vea sin scroll aunque haya muchos
          viajes -era la queja del dueño del producto: no encontrarlo mirando la pantalla
          entera. Mismo destino y mismo estilo que el enlace principal de la
          portada, sin formulario ni ruta nueva. */}
      {viajes.length > 0 && (
        <p>
          <a href="/criterios" className="boton boton-principal">
            {T.pedirOtro.texto}
          </a>
        </p>
      )}

      {viajes.length === 0 && (
        <div className="aviso">
          <p>{T.sinViajes.texto}</p>
          <p>
            <a href="/criterios" className="boton boton-principal">
              {T.empezar.texto}
            </a>
          </p>
        </div>
      )}

      {viajes.length > 0 && (
        <>
          <section aria-labelledby="viajes-proximos" className="pila">
            <h2 id="viajes-proximos">{T.proximos.texto}</h2>
            {proximos.length > 0 ? (
              <ul className="pila">{proximos.map(tarjetaViaje)}</ul>
            ) : (
              <p className="ayuda">{T.sinProximos.texto}</p>
            )}
          </section>
          <section aria-labelledby="viajes-pasados" className="pila">
            <h2 id="viajes-pasados">{T.pasados.texto}</h2>
            {pasados.length > 0 ? (
              <ul className="pila">{pasados.map(tarjetaViaje)}</ul>
            ) : (
              <p className="ayuda">{T.sinPasados.texto}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
