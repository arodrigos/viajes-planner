"use client";

import { useEffect, useState } from "react";
import { piezasReserva } from "@/lib/reservas/resumen";
import { TOPE_RESERVAS, type Reserva } from "@/lib/reservas/tipos";
import { TEXTOS_RESERVAS as T } from "@/lib/textos/reservas";
import { FormularioReserva } from "./FormularioReserva";

// Sección del dueño para apuntar a mano sus reservas. Guardar una reserva no
// toca el plan: esta sección solo habla con /api/plan/[id]/reservas. La lista
// se pide al abrirla (no al cargar el plan) porque son datos personales.
export function SeccionReservas({ planId, fechas, onCambio }: { planId: string; fechas: string[]; onCambio?: (reservas: Reserva[]) => void }) {
  const [abierta, setAbierta] = useState(false);
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const [formulario, setFormulario] = useState<"nueva" | string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [errorBorrar, setErrorBorrar] = useState(false);

  useEffect(() => {
    if (!abierta || reservas !== null) return;
    let vivo = true;
    fetch(`/api/plan/${planId}/reservas`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const datos: Reserva[] = await r.json();
        if (vivo) setReservas(datos);
      })
      .catch(() => {
        if (vivo) setErrorLista(true);
      });
    return () => {
      vivo = false;
    };
  }, [abierta, reservas, planId]);

  // El día necesita la lista del dueño para pintar sus reservas: se le avisa
  // cada vez que cambia, sin que la sección deje de ser autónoma.
  useEffect(() => {
    if (reservas !== null) onCambio?.(reservas);
  }, [reservas, onCambio]);

  const clave = (r: Reserva) => `${r.fecha_inicio}T${r.hora_inicio ?? ""}`;
  const ordenar = (lista: Reserva[]) => [...lista].sort((a, b) => clave(a).localeCompare(clave(b)));

  function guardada(r: Reserva) {
    setReservas((previas) => ordenar([...(previas ?? []).filter((p) => p.id !== r.id), r]));
    setFormulario(null);
  }

  async function borrar(id: string) {
    setErrorBorrar(false);
    try {
      const r = await fetch(`/api/plan/${planId}/reservas/${id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) return setErrorBorrar(true);
      setReservas((previas) => (previas ?? []).filter((p) => p.id !== id));
      setConfirmando(null);
    } catch {
      setErrorBorrar(true);
    }
  }

  const lleno = (reservas?.length ?? 0) >= TOPE_RESERVAS;

  return (
    <details className="seccion-reservas pila" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>{T.titulo}</summary>
      {errorLista && <p role="alert">{T.errorLista}</p>}
      {reservas !== null && reservas.length === 0 && formulario === null && <p className="ayuda" data-testid="reservas-vacio">{T.vacio}</p>}
      {reservas !== null && reservas.length > 0 && (
        <ul className="pila" aria-label={T.titulo}>
          {reservas.map((r) =>
            formulario === r.id ? (
              <li key={r.id}>
                <FormularioReserva planId={planId} fechas={fechas} inicial={r} onGuardada={guardada} onCancelar={() => setFormulario(null)} />
              </li>
            ) : (
              <li key={r.id} className="fila" data-testid="reserva">
                <span data-sensible>{piezasReserva(r).join(" · ")}</span>
                {confirmando === r.id ? (
                  <span className="fila" role="group" aria-label={`${T.borrar}: confirmar`}>
                    <span>{T.confirmarBorrar}</span>
                    <button type="button" autoFocus onClick={() => setConfirmando(null)}>{T.cancelar}</button>
                    <button type="button" className="boton-peligro" onClick={() => void borrar(r.id)}>{T.confirmarBorrarBoton}</button>
                  </span>
                ) : (
                  <span className="fila">
                    <button type="button" onClick={() => setFormulario(r.id)}>{T.editar}</button>
                    <button type="button" className="accion-peligro" onClick={() => setConfirmando(r.id)}>{T.borrar}</button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {errorBorrar && <p role="alert">{T.errorBorrar}</p>}
      {formulario === "nueva" ? (
        <FormularioReserva planId={planId} fechas={fechas} onGuardada={guardada} onCancelar={() => setFormulario(null)} />
      ) : (
        reservas !== null && (
          <>
            {lleno && <p className="ayuda">{T.tope}</p>}
            <button type="button" className="boton" disabled={lleno} onClick={() => setFormulario("nueva")}>{T.apuntar}</button>
          </>
        )
      )}
    </details>
  );
}
