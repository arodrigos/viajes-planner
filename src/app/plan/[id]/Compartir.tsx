"use client";

import { useEffect, useState } from "react";
import { TEXTOS_COMPARTIR as T } from "@/lib/textos/compartir";

interface Miembro {
  id: string;
  correo: string;
}

// Sección del dueño para dar acceso de solo lectura a su plan. La lista se
// pide al abrirla (no al cargar el plan) y cada acción se refleja al momento
// en el botón: el servidor es quien valida el correo y manda el texto del error.
export function Compartir({ planId }: { planId: string }) {
  const [abierta, setAbierta] = useState(false);
  const [miembros, setMiembros] = useState<Miembro[] | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const [correo, setCorreo] = useState("");
  const [invitando, setInvitando] = useState(false);
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null);

  useEffect(() => {
    if (!abierta || miembros !== null) return;
    let vivo = true;
    fetch(`/api/plan/${planId}/miembros`)
      .then(async (respuesta) => {
        if (!respuesta.ok) throw new Error(String(respuesta.status));
        const datos: { miembros: Miembro[] } = await respuesta.json();
        if (vivo) setMiembros(datos.miembros);
      })
      .catch(() => {
        if (vivo) setErrorLista(true);
      });
    return () => {
      vivo = false;
    };
  }, [abierta, miembros, planId]);

  async function invitar(evento: React.FormEvent) {
    evento.preventDefault();
    if (invitando) return;
    setInvitando(true);
    setErrorCampo(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/miembros`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ correo }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        setErrorCampo(typeof datos?.error === "string" ? datos.error : T.errorGenerico);
        return;
      }
      const nuevo: Miembro = { id: datos.id, correo: datos.correo };
      setMiembros((previos) => [...(previos ?? []).filter((m) => m.id !== nuevo.id), nuevo]);
      setCorreo("");
    } catch {
      setErrorCampo(T.errorGenerico);
    } finally {
      setInvitando(false);
    }
  }

  async function quitar(id: string) {
    setQuitando(id);
    setErrorQuitar(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/miembros/${id}`, { method: "DELETE" });
      // 404: ya no estaba; la lista debe quedar sin él igualmente.
      if (!respuesta.ok && respuesta.status !== 404) {
        setErrorQuitar(T.errorGenerico);
        return;
      }
      setMiembros((previos) => (previos ?? []).filter((m) => m.id !== id));
      setConfirmando(null);
    } catch {
      setErrorQuitar(T.errorGenerico);
    } finally {
      setQuitando(null);
    }
  }

  return (
    <details className="compartir pila" open={abierta} onToggle={(evento) => setAbierta(evento.currentTarget.open)}>
      <summary>{T.titulo}</summary>
      <p className="ayuda" id="ayuda-compartir">
        {T.ayuda}
      </p>
      <form className="pila" onSubmit={(evento) => void invitar(evento)} noValidate>
        <label htmlFor="correo-compartir">{T.campo}</label>
        <input
          id="correo-compartir"
          type="email"
          autoComplete="off"
          value={correo}
          data-sensible
          aria-describedby={errorCampo ? "error-compartir ayuda-compartir" : "ayuda-compartir"}
          aria-invalid={errorCampo ? true : undefined}
          onChange={(evento) => setCorreo(evento.target.value)}
          disabled={invitando}
        />
        {errorCampo && (
          <p role="alert" id="error-compartir" className="mensaje-error">
            {errorCampo}
          </p>
        )}
        <button type="submit" className="boton" disabled={invitando}>
          {invitando ? T.invitando : T.invitar}
        </button>
      </form>

      <h3>{T.conAcceso}</h3>
      {errorLista && <p role="alert">{T.errorLista}</p>}
      {miembros !== null && miembros.length === 0 && <p className="ayuda">{T.vacio}</p>}
      {miembros !== null && miembros.length > 0 && (
        <ul className="pila" aria-label={T.conAcceso}>
          {miembros.map((miembro) => (
            <li key={miembro.id} className="fila" data-testid="miembro">
              <span data-sensible>{miembro.correo}</span>
              {confirmando === miembro.id ? (
                <span className="fila" role="group" aria-label={`${T.quitar}: confirmar`}>
                  <span>{T.confirmarQuitar}</span>
                  <button type="button" autoFocus onClick={() => setConfirmando(null)} disabled={quitando === miembro.id}>
                    {T.cancelar}
                  </button>
                  <button type="button" className="boton-peligro" onClick={() => void quitar(miembro.id)} disabled={quitando === miembro.id}>
                    {quitando === miembro.id ? T.quitando : T.confirmarQuitarBoton}
                  </button>
                </span>
              ) : (
                <button type="button" className="accion-peligro" onClick={() => setConfirmando(miembro.id)}>
                  {T.quitar}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {errorQuitar && <p role="alert">{errorQuitar}</p>}
    </details>
  );
}
