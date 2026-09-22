"use client";

import { useEffect, useState } from "react";
import { PanelAcceso } from "../criterios/PanelAcceso";

interface ViajeListado {
  id: string;
  destino: string;
  fecha: string;
  estado: string;
  plan_id: string | null;
}

const ERROR_CARGA =
  "No se ha podido cargar tu lista de viajes. Vuelve a intentarlo en un momento; esta misma dirección seguirá funcionando.";

export function PanelViajes() {
  const [viajes, setViajes] = useState<ViajeListado[] | null>(null);
  const [correo, setCorreo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [necesitaAcceso, setNecesitaAcceso] = useState(false);
  const [recargaId, setRecargaId] = useState(0);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

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
          setError(ERROR_CARGA);
          return;
        }
        const datos: { correo: string; viajes: ViajeListado[] } = await respuesta.json();
        if (cancelado) return;
        setError(null);
        setNecesitaAcceso(false);
        setCorreo(datos.correo);
        setViajes(datos.viajes);
      } catch {
        if (!cancelado) setError(ERROR_CARGA);
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
  if (error) return <p role="alert">{error}</p>;

  if (!viajes) return <p>Cargando tus viajes…</p>;

  return (
    <div className="pila">
      <div className="fila">
        {/* viajes-ac4: texto de ayuda que aclara de qué cuenta es la lista. */}
        <p className="ayuda">Estos son los viajes de la cuenta ligada a {correo}.</p>
        <button type="button" onClick={() => void cerrarSesion()} disabled={cerrandoSesion}>
          {cerrandoSesion ? "Cerrando…" : "Cerrar sesión"}
        </button>
      </div>

      {viajes.length === 0 && (
        <div className="aviso">
          <p>Todavía no has pedido ningún viaje.</p>
          <p>
            <a href="/criterios" className="boton boton-principal">
              Cuéntanos tu viaje
            </a>
          </p>
        </div>
      )}

      {viajes.length > 0 && (
        <ul className="pila">
          {viajes.map((viaje) => {
            // viajes-ac1: completado enlaza a su plan; cualquier otro estado
            // (encolado, en-curso, pausado, fallido, caducado) enlaza a la
            // pantalla de progreso, que ya sabe explicar cada uno de ellos.
            const enlace =
              viaje.estado === "completado" && viaje.plan_id
                ? { href: `/plan/${viaje.plan_id}`, texto: "Ver el itinerario" }
                : { href: `/trabajos/${viaje.id}`, texto: "Ver el progreso" };
            return (
              <li key={viaje.id} className="tarjeta-parada">
                <div>
                  <strong>{viaje.destino}</strong>
                  <p>{viaje.fecha}</p>
                  <p className="ayuda">{viaje.estado}</p>
                </div>
                <a href={enlace.href}>{enlace.texto}</a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
