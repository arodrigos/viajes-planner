"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compararGasto } from "@/lib/gastos/comparar";
import { TOPE_GASTOS, type Gasto, type GastoEntrada } from "@/lib/gastos/tipos";
import { formatearEurosCentimos as eur } from "@/lib/formato/numeros";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import { ERRORES_GASTO as E, TEXTOS_GASTOS as T } from "@/lib/textos/gastos";
import { FormularioGasto } from "./FormularioGasto";

interface Props {
  planId: string;
  fechas: string[];
  hoy: string;
  presupuesto: PresupuestoPublico;
}

const MS_DESHACER = 8000;

function aPresupuesto(p: PresupuestoPublico, fechas: string[]) {
  // Planes calculados antes de por_dia: sin desglose por día, todo a cero.
  return { por_dia: p.por_dia ?? fechas.map((fecha) => ({ fecha, total_eur: 0 })), total_eur: p.total_eur, alojamiento_eur: p.alojamiento_eur ?? 0 };
}

// Pestaña de gastos del dueño: lo gastado frente al presupuesto estimado que el
// plan ya calcula. Solo habla con /api/plan/[id]/gastos y nunca toca el plan. La
// lista se pide al abrirla porque son datos personales.
export function SeccionGastos({ planId, fechas, hoy, presupuesto }: Props) {
  const [abierta, setAbierta] = useState(false);
  const [gastos, setGastos] = useState<Gasto[] | null>(null);
  const [errorLista, setErrorLista] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [errorBorrar, setErrorBorrar] = useState(false);
  const [deshacer, setDeshacer] = useState<Gasto | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!abierta || gastos !== null) return;
    let vivo = true;
    fetch(`/api/plan/${planId}/gastos`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const datos: Gasto[] = await r.json();
        if (vivo) setGastos(datos);
      })
      .catch(() => {
        if (vivo) setErrorLista(true);
      });
    return () => {
      vivo = false;
    };
  }, [abierta, gastos, planId]);

  useEffect(() => () => void (temporizador.current && clearTimeout(temporizador.current)), []);

  const diaInicial = fechas.includes(hoy) ? hoy : (fechas[0] ?? "");
  const comparacion = useMemo(() => compararGasto(aPresupuesto(presupuesto, fechas), gastos ?? [], fechas), [presupuesto, fechas, gastos]);

  async function guardar(entrada: GastoEntrada, idExistente?: string): Promise<string | null> {
    const id = idExistente ?? crypto.randomUUID();
    try {
      const r = await fetch(`/api/plan/${planId}/gastos/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(entrada) });
      if (!r.ok) {
        const cuerpo = (await r.json().catch(() => ({}))) as { error?: string };
        return cuerpo.error ?? T.errorGuardar;
      }
    } catch {
      return T.errorGuardar;
    }
    const nuevo: Gasto = { id, ...entrada };
    setGastos((previos) => [nuevo, ...(previos ?? []).filter((g) => g.id !== id)]);
    setEditando(null);
    return null;
  }

  async function borrar(gasto: Gasto) {
    setErrorBorrar(false);
    try {
      const r = await fetch(`/api/plan/${planId}/gastos/${gasto.id}`, { method: "DELETE" });
      if (!r.ok) return setErrorBorrar(true);
    } catch {
      return setErrorBorrar(true);
    }
    setGastos((previos) => (previos ?? []).filter((g) => g.id !== gasto.id));
    setConfirmando(null);
    setDeshacer(gasto);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setDeshacer(null), MS_DESHACER);
  }

  // Deshacer vuelve a subir el mismo gasto con el mismo id y una marca más nueva.
  async function recuperar() {
    if (!deshacer) return;
    const { id, ...resto } = deshacer;
    setDeshacer(null);
    await guardar({ ...resto, actualizado_cliente: new Date().toISOString() }, id);
  }

  const { total, alojamiento, sin_dia_c, por_dia } = comparacion;
  const pasado = total.queda_c < 0;
  const lleno = (gastos?.length ?? 0) >= TOPE_GASTOS;
  const descripcion = (g: Gasto) => {
    const dia = g.fecha ? `${T.dia.toLowerCase()} ${fechas.indexOf(g.fecha) + 1}` : T.todoElViaje.toLowerCase();
    return [T.categorias[g.categoria], eur(g.importe_centimos), dia, g.concepto].filter(Boolean).join(" · ");
  };

  return (
    <details className="seccion-gastos pila" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>{T.titulo}</summary>
      {errorLista && <p role="alert">{T.errorLista}</p>}
      {gastos !== null && (
        <>
          <p className={pasado ? "titular-gasto gasto-pasado" : "titular-gasto"} data-testid="gastos-titular">
            <strong>{pasado ? T.pasado(eur(-total.queda_c)) : T.queda(eur(total.queda_c))}</strong>
          </p>
          <p className="ayuda" data-testid="gastos-resumen">{T.gastadoDe(eur(total.gastado_c), eur(total.estimado_c))}</p>
          <ul className="pila desglose-gastos" aria-label="Desglose">
            <li className="fila" data-testid="gastos-fila-alojamiento">
              <span>{T.filaAlojamiento}</span>
              <span>{T.deEstimado(eur(alojamiento.gastado_c), eur(alojamiento.estimado_c))}</span>
            </li>
            {sin_dia_c > 0 && (
              <li className="fila" data-testid="gastos-fila-sin-dia">
                <span>{T.filaTodoElViaje}</span>
                <span>{eur(sin_dia_c)}</span>
              </li>
            )}
            {por_dia.map((d, i) => (
              <li key={d.fecha} className={d.pasado ? "fila gasto-pasado" : "fila"} data-testid="gastos-fila-dia">
                <span>{T.filaDia(i + 1, `${d.fecha.slice(8)}/${d.fecha.slice(5, 7)}`)}</span>
                <span>
                  {T.deEstimado(eur(d.gastado_c), eur(d.estimado_c))}
                  {d.pasado && <> · {T.mas(eur(d.gastado_c - d.estimado_c))}</>}
                </span>
              </li>
            ))}
          </ul>
          {gastos.length === 0 && <p className="ayuda" data-testid="gastos-vacio">{T.vacio}</p>}
        </>
      )}
      {gastos !== null && !lleno && editando === null && <FormularioGasto fechas={fechas} diaInicial={diaInicial} onGuardar={guardar} />}
      {lleno && <p className="ayuda">{E.tope}</p>}
      {gastos !== null && gastos.length > 0 && (
        <ul className="pila" aria-label={T.titulo}>
          {gastos.map((g) =>
            editando === g.id ? (
              <li key={g.id}>
                <FormularioGasto fechas={fechas} diaInicial={diaInicial} inicial={g} onGuardar={guardar} onCancelar={() => setEditando(null)} />
              </li>
            ) : (
              <li key={g.id} className="fila" data-testid="gasto">
                <span data-sensible>{descripcion(g)}</span>
                {confirmando === g.id ? (
                  <span className="fila" role="group" aria-label={`${T.borrar}: confirmar`}>
                    <span>{T.confirmarBorrar}</span>
                    <button type="button" autoFocus onClick={() => setConfirmando(null)}>{T.cancelar}</button>
                    <button type="button" className="boton-peligro" onClick={() => void borrar(g)}>{T.confirmarBorrarBoton}</button>
                  </span>
                ) : (
                  <span className="fila">
                    <button type="button" onClick={() => setEditando(g.id)}>{T.editar}</button>
                    <button type="button" className="accion-peligro" onClick={() => setConfirmando(g.id)}>{T.borrar}</button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {errorBorrar && <p role="alert">{T.errorBorrar}</p>}
      {deshacer && (
        <p role="status" className="fila" data-testid="gastos-deshacer">
          <span>{T.borrado}</span>
          <button type="button" onClick={() => void recuperar()}>{T.deshacer}</button>
        </p>
      )}
    </details>
  );
}
