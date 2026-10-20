"use client";

import { useId, useState } from "react";
import { limpiarTexto, NOMBRE_MAX, validarSitio } from "@/lib/plan/sitiosPropios";
import { TEXTOS_ANADIR_SITIO } from "./AnadirSitio";
import type { ParadaPublica } from "./tiposVista";

export const TEXTOS_SITIO_PROPIO = {
  buscando: "Buscando… suele tardar unos minutos",
  corregir: "Corregir nombre",
  quitar: "Quitar este sitio",
  confirmarQuitar: "¿Quitar este sitio del plan?",
  siQuitar: "Sí, quitar",
  noQuitar: "No",
} as const;

export interface AccionesSitio {
  onCorregir: (nombre: string) => Promise<boolean>;
  onQuitar: () => Promise<boolean>;
}

// La parte de la tarjeta que solo tiene un sitio que puso el usuario: cómo va
// su búsqueda, corregir el nombre y quitarlo. Sin `acciones` (la tarjeta
// provisional, que aún no tiene id en el servidor) solo enseña el estado.
export function EstadoSitioPropio({ parada, acciones }: { parada: ParadaPublica; acciones?: AccionesSitio }) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(parada.nombre);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const id = useId();
  const estado = parada.estadoSitio ?? "buscando";

  function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!acciones) return;
    if (limpiarTexto(nombre) === "") {
      setError(TEXTOS_ANADIR_SITIO.nombreVacio);
      return;
    }
    const valido = validarSitio(nombre, undefined, false);
    if ("error" in valido) {
      setError(valido.error);
      return;
    }
    setEditando(false);
    setError(null);
    void acciones.onCorregir(valido.nombre);
  }

  return (
    <div className="estado-sitio" data-testid="estado-sitio" data-estado={estado}>
      {estado === "buscando" && (
        <p role="status" className="ayuda" data-testid="sitio-buscando">
          {TEXTOS_SITIO_PROPIO.buscando}
        </p>
      )}
      {(estado === "no-encontrado" || estado === "error") && parada.motivoSitio && (
        <p className="mensaje-error" data-testid="motivo-sitio">
          {parada.motivoSitio}
        </p>
      )}

      {acciones && editando && (
        <form className="pila" onSubmit={guardar} noValidate>
          <div className="campo">
            <label htmlFor={`${id}-nombre`}>Nombre del sitio</label>
            <input id={`${id}-nombre`} type="text" value={nombre} maxLength={NOMBRE_MAX} autoFocus aria-describedby={`${id}-ayuda`} onChange={(e) => setNombre(e.target.value)} />
            <p className="ayuda" id={`${id}-ayuda`}>
              {TEXTOS_ANADIR_SITIO.ayudaNombre}
            </p>
            {error && (
              <p role="alert" className="mensaje-error">
                {error}
              </p>
            )}
          </div>
          <div className="fila">
            <button type="submit" className="boton boton-principal">
              Guardar
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setEditando(false);
                setError(null);
                setNombre(parada.nombre);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {acciones && !editando && (
        <div className="fila acciones-sitio">
          {(estado === "no-encontrado" || estado === "error") && (
            <button
              type="button"
              className="boton"
              onClick={() => {
                setNombre(parada.nombre);
                setEditando(true);
              }}
            >
              {TEXTOS_SITIO_PROPIO.corregir}
            </button>
          )}
          {confirmando ? (
            <>
              <span role="alert">{TEXTOS_SITIO_PROPIO.confirmarQuitar}</span>
              <button type="button" className="boton boton-principal" onClick={() => void acciones.onQuitar()}>
                {TEXTOS_SITIO_PROPIO.siQuitar}
              </button>
              <button type="button" className="boton" onClick={() => setConfirmando(false)}>
                {TEXTOS_SITIO_PROPIO.noQuitar}
              </button>
            </>
          ) : (
            <button type="button" className="boton" onClick={() => setConfirmando(true)}>
              {TEXTOS_SITIO_PROPIO.quitar}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
