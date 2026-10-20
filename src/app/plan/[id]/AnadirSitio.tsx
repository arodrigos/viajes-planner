"use client";

import { useId, useState } from "react";
import { limpiarTexto, NOMBRE_MAX, NOTA_MAX, validarSitio } from "@/lib/plan/sitiosPropios";

export const TEXTOS_ANADIR_SITIO = {
  abrir: "Añadir un sitio",
  ayudaNombre: "Escribe el nombre como sale en el mapa, por ejemplo «Heladería Fassi»",
  ayudaNota: "La verán también quienes tengan acceso a este plan",
  nombreVacio: "Escribe el nombre del sitio, por ejemplo «Heladería Fassi»",
} as const;

// Formulario corto de «Añadir un sitio». No espera al servidor: llama a
// `onAnadir` y se cierra, y la tarjeta provisional la pinta el panel del día.
export function AnadirSitio({ onAnadir }: { onAnadir: (nombre: string, nota: string | null) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  function cerrar() {
    setAbierto(false);
    setNombre("");
    setNota("");
    setError(null);
  }

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (limpiarTexto(nombre) === "") {
      setError(TEXTOS_ANADIR_SITIO.nombreVacio);
      return;
    }
    const sitio = validarSitio(nombre, nota, true);
    if ("error" in sitio) {
      setError(sitio.error);
      return;
    }
    onAnadir(sitio.nombre, sitio.nota);
    cerrar();
  }

  if (!abierto) {
    return (
      <div className="anadir-sitio">
        <button type="button" className="boton" onClick={() => setAbierto(true)}>
          {TEXTOS_ANADIR_SITIO.abrir}
        </button>
      </div>
    );
  }

  return (
    <form className="anadir-sitio formulario-sitio pila" onSubmit={enviar} noValidate>
      <div className="campo">
        <label htmlFor={`${id}-nombre`}>Nombre del sitio</label>
        <input
          id={`${id}-nombre`}
          type="text"
          value={nombre}
          maxLength={NOMBRE_MAX}
          autoFocus
          aria-describedby={`${id}-ayuda-nombre${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setNombre(e.target.value)}
        />
        <p className="ayuda" id={`${id}-ayuda-nombre`}>
          {TEXTOS_ANADIR_SITIO.ayudaNombre}
        </p>
        {error && (
          <p role="alert" className="mensaje-error" id={`${id}-error`}>
            {error}
          </p>
        )}
      </div>
      <div className="campo">
        <label htmlFor={`${id}-nota`}>Nota (opcional)</label>
        <textarea id={`${id}-nota`} rows={2} value={nota} maxLength={NOTA_MAX} aria-describedby={`${id}-ayuda-nota`} onChange={(e) => setNota(e.target.value)} />
        <p className="ayuda" id={`${id}-ayuda-nota`}>
          <span data-testid="contador-nota">
            {Array.from(nota).length}/{NOTA_MAX}
          </span>
          {" · "}
          {TEXTOS_ANADIR_SITIO.ayudaNota}
        </p>
      </div>
      <div className="fila">
        <button type="submit" className="boton boton-principal">
          Añadir
        </button>
        <button type="button" className="boton" onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
