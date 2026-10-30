"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compararGasto } from "@/lib/gastos/comparar";
import { colaDeSalida } from "@/lib/gastos/cola";
import { claveGasto, fusionarLista, paraTotales, sinSubir, type GastoVista } from "@/lib/gastos/lista";
import { TOPE_GASTOS, type Gasto, type GastoEntrada } from "@/lib/gastos/tipos";
import { formatearEurosCentimos as eur } from "@/lib/formato/numeros";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import { esperaMs, type OperacionCola } from "@/lib/sinConexion/colaSalida";
import { ERRORES_GASTO as E, TEXTOS_GASTOS as T } from "@/lib/textos/gastos";
import { FormularioGasto } from "./FormularioGasto";

interface Props {
  planId: string;
  fechas: string[];
  hoy: string;
  presupuesto: PresupuestoPublico;
}

const MS_DESHACER = 8000;
// Sin sesión no hay un fallo que vaya a cambiar solo; se vuelve a mirar de vez en cuando.
const MS_REINTENTO_SIN_SESION = 30_000;

function pareceUnGasto(g: unknown): g is Gasto {
  if (typeof g !== "object" || g === null) return false;
  const { id, importe_centimos } = g as { id?: unknown; importe_centimos?: unknown };
  return typeof id === "string" && typeof importe_centimos === "number" && Number.isFinite(importe_centimos);
}

function aPresupuesto(p: PresupuestoPublico, fechas: string[]) {
  // Planes calculados antes de por_dia: sin desglose por día, todo a cero.
  return { por_dia: p.por_dia ?? fechas.map((fecha) => ({ fecha, total_eur: 0 })), total_eur: p.total_eur, alojamiento_eur: p.alojamiento_eur ?? 0 };
}

// Pestaña de gastos del dueño: lo gastado frente al presupuesto estimado que el
// plan ya calcula. Todo alta, edición y borrado pasa por la cola de salida (se
// intenta subir enseguida y, sin red, espera): la lista es el espejo del
// servidor guardado en IndexedDB más lo pendiente. Nunca toca el plan.
export function SeccionGastos({ planId, fechas, hoy, presupuesto }: Props) {
  const [abierta, setAbierta] = useState(false);
  const [espejo, setEspejo] = useState<Gasto[] | null>(null);
  const [operaciones, setOperaciones] = useState<OperacionCola[]>([]);
  const [errorLista, setErrorLista] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [errorBorrar, setErrorBorrar] = useState(false);
  const [deshacer, setDeshacer] = useState<Gasto | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abiertaRef = useRef(false);

  const refrescarOperaciones = useCallback(async () => {
    try {
      setOperaciones(await colaDeSalida().pendientes(planId));
    } catch {
      // Sin IndexedDB utilizable (navegación privada, cuota) no hay cola que
      // enseñar; la lista del servidor sigue funcionando.
      setOperaciones([]);
    }
  }, [planId]);

  // La verdad es el servidor: tras subir algo (o al abrir) se vuelve a pedir la
  // lista y se guarda como espejo para poder verla después sin red.
  const traerDelServidor = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`/api/plan/${planId}/gastos`);
      if (!r.ok) return false;
      const datos: unknown = await r.json();
      // Un elemento sin id o sin importe rompía la suma y la lista, y además
      // se quedaba guardado en el espejo para la próxima vez sin red.
      if (!Array.isArray(datos) || !datos.every(pareceUnGasto)) return false;
      setEspejo(datos);
      setErrorLista(false);
      await colaDeSalida().guardarEspejo(planId, datos).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, [planId]);

  const sincronizar = useCallback(async () => {
    try {
      const { subidas } = await colaDeSalida().sincronizar();
      if (subidas > 0 && abiertaRef.current) await traerDelServidor();
    } catch {
      // La cola no deja de existir por un fallo puntual: el reintento lo recoge.
    }
    await refrescarOperaciones();
  }, [refrescarOperaciones, traerDelServidor]);

  useEffect(() => {
    abiertaRef.current = abierta;
    if (!abierta) return;
    let vivo = true;
    void (async () => {
      const cola = colaDeSalida();
      const copia = await cola.leerEspejo<Gasto>(planId).catch(() => null);
      if (!vivo) return;
      if (copia) setEspejo(copia.datos);
      await refrescarOperaciones();
      await sincronizar();
      const ok = await traerDelServidor();
      if (vivo && !ok && !copia) setErrorLista(true);
    })();
    return () => {
      vivo = false;
    };
  }, [abierta, planId, refrescarOperaciones, sincronizar, traerDelServidor]);

  // Cuándo se intenta subir: al volver la red y al volver la página a primer plano.
  useEffect(() => {
    const alVolver = () => void sincronizar();
    const alVer = () => document.visibilityState === "visible" && alVolver();
    window.addEventListener("online", alVolver);
    document.addEventListener("visibilitychange", alVer);
    const baja = colaDeSalida().alCambiar(() => void refrescarOperaciones());
    return () => {
      window.removeEventListener("online", alVolver);
      document.removeEventListener("visibilitychange", alVer);
      baja();
    };
  }, [sincronizar, refrescarOperaciones]);

  // Espera creciente tras un fallo de red o de servidor; sin conexión declarada
  // no se insiste (lo despierta el evento online).
  useEffect(() => {
    const vivas = operaciones.filter((o) => o.estado !== "rechazada");
    if (vivas.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const sinSesion = vivas.some((o) => o.estado === "sin-sesion");
    const intentos = Math.max(0, ...vivas.map((o) => o.intentos));
    if (!sinSesion && intentos === 0) return;
    const t = setTimeout(() => void sincronizar(), sinSesion ? MS_REINTENTO_SIN_SESION : esperaMs(intentos));
    return () => clearTimeout(t);
  }, [operaciones, sincronizar]);

  useEffect(() => () => void (temporizador.current && clearTimeout(temporizador.current)), []);

  const lista: GastoVista[] = useMemo(() => fusionarLista(espejo ?? [], operaciones), [espejo, operaciones]);
  const diaInicial = fechas.includes(hoy) ? hoy : (fechas[0] ?? "");
  const comparacion = useMemo(() => compararGasto(aPresupuesto(presupuesto, fechas), paraTotales(lista), fechas), [presupuesto, fechas, lista]);
  const porSubir = sinSubir(lista);
  const sinSesion = lista.filter((g) => g.estado === "sin-sesion").length;

  async function guardar(entrada: GastoEntrada, idExistente?: string): Promise<string | null> {
    const id = idExistente ?? crypto.randomUUID();
    try {
      await colaDeSalida().encolar({ clave: claveGasto(id), ambito: planId, tipo: "guardar", url: `/api/plan/${planId}/gastos/${id}`, cuerpo: entrada });
    } catch {
      return T.errorEncolar;
    }
    setEditando(null);
    await refrescarOperaciones();
    void sincronizar();
    return null;
  }

  async function borrar(gasto: GastoVista) {
    setErrorBorrar(false);
    try {
      await colaDeSalida().encolar({ clave: claveGasto(gasto.id), ambito: planId, tipo: "borrar", url: `/api/plan/${planId}/gastos/${gasto.id}` });
    } catch {
      return setErrorBorrar(true);
    }
    setConfirmando(null);
    setDeshacer({ id: gasto.id, importe_centimos: gasto.importe_centimos, fecha: gasto.fecha, categoria: gasto.categoria, concepto: gasto.concepto, actualizado_cliente: gasto.actualizado_cliente });
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setDeshacer(null), MS_DESHACER);
    await refrescarOperaciones();
    void sincronizar();
  }

  // Deshacer vuelve a subir el mismo gasto con el mismo id y una marca más nueva.
  async function recuperar() {
    if (!deshacer) return;
    const { id, ...resto } = deshacer;
    setDeshacer(null);
    await guardar({ ...resto, actualizado_cliente: new Date().toISOString() }, id);
  }

  async function descartar(gasto: GastoVista) {
    await colaDeSalida().descartar(claveGasto(gasto.id));
    await refrescarOperaciones();
  }

  const { total, alojamiento, sin_dia_c, por_dia } = comparacion;
  const pasado = total.queda_c < 0;
  const cargado = espejo !== null;
  const lleno = lista.length >= TOPE_GASTOS;
  const descripcion = (g: Gasto) => {
    const dia = g.fecha ? `${T.dia.toLowerCase()} ${fechas.indexOf(g.fecha) + 1}` : T.todoElViaje.toLowerCase();
    return [T.categorias[g.categoria], eur(g.importe_centimos), dia, g.concepto].filter(Boolean).join(" · ");
  };

  return (
    <details className="seccion-gastos pila" open={abierta} onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>{T.titulo}</summary>
      {errorLista && <p role="alert">{T.errorLista}</p>}
      {cargado && (
        <>
          <p className={pasado ? "titular-gasto gasto-pasado" : "titular-gasto"} data-testid="gastos-titular">
            <strong>{pasado ? T.pasado(eur(-total.queda_c)) : T.queda(eur(total.queda_c))}</strong>
          </p>
          <p className="ayuda" data-testid="gastos-resumen">{T.gastadoDe(eur(total.gastado_c), eur(total.estimado_c))}</p>
          {porSubir > 0 && <p role="status" className="ayuda" data-testid="gastos-sin-subir">{T.sinSubir(porSubir)}</p>}
          {sinSesion > 0 && (
            <p role="alert" data-testid="gastos-sin-sesion">
              {T.sinSesion(sinSesion)}. <Link href="/viajes">{T.enlaceAcceso}</Link>
            </p>
          )}
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
          {lista.length === 0 && <p className="ayuda" data-testid="gastos-vacio">{T.vacio}</p>}
        </>
      )}
      {cargado && !lleno && editando === null && <FormularioGasto fechas={fechas} diaInicial={diaInicial} onGuardar={guardar} />}
      {lleno && <p className="ayuda">{E.tope}</p>}
      {cargado && lista.length > 0 && (
        <ul className="pila" aria-label={T.titulo}>
          {lista.map((g) =>
            editando === g.id ? (
              <li key={g.id}>
                <FormularioGasto fechas={fechas} diaInicial={diaInicial} inicial={g} onGuardar={guardar} onCancelar={() => setEditando(null)} />
              </li>
            ) : (
              <li key={g.id} className={g.estado === "rechazado" ? "fila gasto-rechazado" : "fila"} data-testid="gasto" data-estado={g.estado}>
                <span data-sensible>{descripcion(g)}</span>
                {(g.estado === "pendiente" || g.estado === "sin-sesion") && <span className="marca-pendiente" data-testid="gasto-pendiente">{T.pendiente}</span>}
                {g.estado === "rechazado" && <span role="alert" data-testid="gasto-rechazado">{g.error ? T.rechazado(g.error) : T.rechazadoSinMotivo}</span>}
                {confirmando === g.id ? (
                  <span className="fila" role="group" aria-label={`${T.borrar}: confirmar`}>
                    <span>{T.confirmarBorrar}</span>
                    <button type="button" autoFocus onClick={() => setConfirmando(null)}>{T.cancelar}</button>
                    <button type="button" className="boton-peligro" onClick={() => void borrar(g)}>{T.confirmarBorrarBoton}</button>
                  </span>
                ) : (
                  <span className="fila">
                    <button type="button" onClick={() => setEditando(g.id)}>{T.editar}</button>
                    {g.estado === "rechazado" ? (
                      <button type="button" onClick={() => void descartar(g)}>{T.descartar}</button>
                    ) : (
                      <button type="button" className="accion-peligro" onClick={() => setConfirmando(g.id)}>{T.borrar}</button>
                    )}
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
