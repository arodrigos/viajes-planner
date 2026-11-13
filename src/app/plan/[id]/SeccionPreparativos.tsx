"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generarPreparativos } from "@/lib/preparativos/generar";
import { colaPreparativos } from "@/lib/preparativos/cola";
import type { CategoriaPreparativo, DatosPreparativos } from "@/lib/preparativos/tipos";
import type { EstadoMarca } from "@/lib/preparativos/validar";
import { claveMarca, componerLista, progreso, sinSubir, type ElementoVista, type MarcaLocal } from "@/lib/preparativos/vista";
import type { TipoReserva } from "@/lib/reservas/tipos";
import { esperaMs, type OperacionCola } from "@/lib/sinConexion/colaSalida";
import { TEXTOS_PREPARATIVOS as T } from "@/lib/textos/preparativos";

interface Props {
  planId: string;
  // Ausente mientras el plan se genera o si los criterios no traen los datos.
  datos: DatosPreparativos | undefined;
  latitud: number | null;
  tiposReserva: TipoReserva[];
}

const MS_DESHACER = 5000;
const MS_REINTENTO_SIN_SESION = 30_000;
const ORDEN: CategoriaPreparativo[] = ["documentos", "ninos", "salud", "ropa", "electronica", "antes-de-salir"];

function pareceMarca(m: unknown): m is MarcaLocal {
  if (typeof m !== "object" || m === null) return false;
  const { elemento, estado, actualizado_cliente } = m as Record<string, unknown>;
  return typeof elemento === "string" && typeof actualizado_cliente === "string" && (estado === "pendiente" || estado === "hecho" || estado === "no_hace_falta");
}

// Pasa a `marcas` lo que la cola acaba de subir, con el sello con que se envió.
function aplicarSubidas(marcas: MarcaLocal[] | null, subidas: OperacionCola[], planId: string): MarcaLocal[] | null {
  const prefijo = claveMarca(planId, "");
  const mapa = new Map((marcas ?? []).map((m) => [m.elemento, m]));
  for (const op of subidas) {
    const c = op.cuerpo as { estado?: unknown; actualizado_cliente?: unknown } | undefined;
    if (!op.clave.startsWith(prefijo) || !pareceMarca({ elemento: "x", ...c })) continue;
    const elemento = op.clave.slice(prefijo.length);
    mapa.set(elemento, { elemento, estado: c!.estado as EstadoMarca, actualizado_cliente: c!.actualizado_cliente as string });
  }
  return [...mapa.values()];
}

const selloMonotonico = (anterior: number) => Math.max(Date.now(), anterior + 1);

// Casillas para preparar la maleta. Marcar es optimista: se encola en la cola
// propia (se intenta subir enseguida y, sin red, espera) y la lista es el espejo
// del servidor guardado en IndexedDB más lo pendiente. Solo la monta el dueño.
export function SeccionPreparativos({ planId, datos, latitud, tiposReserva }: Props) {
  const [abierta, setAbierta] = useState(false);
  const [marcas, setMarcas] = useState<MarcaLocal[] | null>(null);
  const [operaciones, setOperaciones] = useState<OperacionCola[]>([]);
  const [errorMarcas, setErrorMarcas] = useState(false);
  const [copiaDe, setCopiaDe] = useState<string | null>(null);
  const [errorEncolar, setErrorEncolar] = useState(false);
  const [quitada, setQuitada] = useState<{ id: string; texto: string } | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // Marcas pintadas antes de que la cola (IndexedDB) las confirme: el toque se ve al instante.
  const [optimistas, setOptimistas] = useState<Record<string, EstadoMarca>>({});
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abiertaRef = useRef(false);
  const ultimoSello = useRef(0);
  const anteriores = useRef<OperacionCola[]>([]);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, []);

  const elementos = useMemo(
    () => (datos ? generarPreparativos({ ...datos, latitud, pais: null, tiposReserva }) : []),
    [datos, latitud, tiposReserva],
  );

  const refrescarOperaciones = useCallback(async () => {
    try {
      const pendientes = await colaPreparativos().pendientes(planId);
      if (!montado.current) return;
      // Una operación viva que desaparece de la cola es que el servidor la aceptó (las
      // rechazadas se quedan hasta descartarlas). Su estado pasa a `marcas` en el mismo
      // render en que la cola la suelta; si no, la fila vuelve un instante al estado viejo
      // del servidor hasta que llega el GET, y un toque en ese hueco guarda lo contrario.
      const siguen = new Set(pendientes.map((o) => o.clave));
      const subidas = anteriores.current.filter((o) => o.estado !== "rechazada" && !siguen.has(o.clave));
      anteriores.current = pendientes;
      if (subidas.length > 0) setMarcas((m) => aplicarSubidas(m, subidas, planId));
      setOperaciones(pendientes);
    } catch {
      if (montado.current) setOperaciones([]);
    }
  }, [planId]);

  const traerDelServidor = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`/api/plan/${planId}/preparativos`);
      if (!r.ok) return false;
      const cuerpo = (await r.json()) as { marcas?: unknown };
      // Una marca mal formada se quedaría en el espejo para la próxima vez sin red.
      if (!Array.isArray(cuerpo.marcas) || !cuerpo.marcas.every(pareceMarca)) return false;
      const lista = cuerpo.marcas as MarcaLocal[];
      if (montado.current) {
        setMarcas(lista);
        setErrorMarcas(false);
        setCopiaDe(null);
      }
      await colaPreparativos().guardarEspejo(planId, lista.map((m) => ({ id: m.elemento, ...m }))).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, [planId]);

  const sincronizar = useCallback(async () => {
    try {
      const { subidas } = await colaPreparativos().sincronizar();
      if (subidas > 0 && abiertaRef.current) await traerDelServidor();
    } catch {
      // El siguiente disparador (red, visibilidad) lo recoge.
    }
    await refrescarOperaciones();
  }, [refrescarOperaciones, traerDelServidor]);

  const cargar = useCallback(async () => {
    const copia = await colaPreparativos().leerEspejo<MarcaLocal & { id: string }>(planId).catch(() => null);
    if (!montado.current) return;
    if (copia) setMarcas(copia.datos);
    await refrescarOperaciones();
    await sincronizar();
    const ok = await traerDelServidor();
    if (!montado.current || ok) return;
    if (copia) setCopiaDe(copia.guardadoEn);
    else {
      setErrorMarcas(true);
      // Sin copia ni servidor la lista se ve igual, todo pendiente.
      setMarcas((m) => m ?? []);
    }
  }, [planId, refrescarOperaciones, sincronizar, traerDelServidor]);

  useEffect(() => {
    abiertaRef.current = abierta;
    if (!abierta) return;
    void (async () => cargar())();
  }, [abierta, cargar]);

  // Cuándo se intenta subir: al volver la red y al volver la página a primer plano.
  useEffect(() => {
    const alVolver = () => void sincronizar();
    const alVer = () => document.visibilityState === "visible" && alVolver();
    window.addEventListener("online", alVolver);
    document.addEventListener("visibilitychange", alVer);
    const baja = colaPreparativos().alCambiar(() => void refrescarOperaciones());
    // Apertura de la página: si quedó algo pendiente de otra visita, se sube ya.
    alVolver();
    return () => {
      window.removeEventListener("online", alVolver);
      document.removeEventListener("visibilitychange", alVer);
      baja();
    };
  }, [sincronizar, refrescarOperaciones]);

  useEffect(() => {
    const vivas = operaciones.filter((o) => o.estado !== "rechazada");
    if (vivas.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const sinSesion = vivas.some((o) => o.estado === "sin-sesion");
    const intentos = Math.max(0, ...vivas.map((o) => o.intentos));
    if (!sinSesion && intentos === 0) return;
    const t = setTimeout(() => void sincronizar(), sinSesion ? MS_REINTENTO_SIN_SESION : esperaMs(intentos));
    return () => clearTimeout(t);
  }, [operaciones, sincronizar]);

  const lista = useMemo(() => {
    const provisionales: OperacionCola[] = Object.entries(optimistas).map(([id, estado]) => ({
      clave: claveMarca(planId, id), ambito: planId, tipo: "guardar", url: "", cuerpo: { estado }, creada: "", intentos: 0, estado: "pendiente", rev: Number.MAX_SAFE_INTEGER,
    }));
    return componerLista(elementos, marcas ?? [], [...operaciones, ...provisionales], planId);
  }, [elementos, marcas, operaciones, optimistas, planId]);
  const { hechos, total } = progreso(lista);
  const porSubir = sinSubir(lista);
  const sinSesion = lista.filter((e) => e.subida === "sin-sesion").length;
  const descartados = lista.filter((e) => e.estado === "no_hace_falta");

  async function marcar(e: ElementoVista, estado: EstadoMarca): Promise<boolean> {
    setErrorEncolar(false);
    // Monotónico: dos marcas seguidas del mismo elemento no pueden empatar y que la vieja gane.
    const sello = selloMonotonico(ultimoSello.current);
    ultimoSello.current = sello;
    setOptimistas((o) => ({ ...o, [e.id]: estado }));
    try {
      await colaPreparativos().encolar({
        clave: claveMarca(planId, e.id),
        ambito: planId,
        tipo: "guardar",
        url: `/api/plan/${planId}/preparativos/${e.id}`,
        cuerpo: { estado, actualizado_cliente: new Date(sello).toISOString() },
      });
    } catch {
      setOptimistas(({ [e.id]: _, ...resto }) => resto);
      setErrorEncolar(true);
      return false;
    }
    await refrescarOperaciones();
    // Ya está en la cola: ella manda (así «pendiente de subir» sale de verdad de la cola).
    if (montado.current) setOptimistas(({ [e.id]: _, ...resto }) => resto);
    void sincronizar();
    return true;
  }

  async function alternar(e: ElementoVista) {
    const nuevo: EstadoMarca = e.estado === "hecho" ? "pendiente" : "hecho";
    setAnuncio(`${e.texto}: ${nuevo === "hecho" ? "marcado" : "desmarcado"}`);
    await marcar(e, nuevo);
  }

  async function quitar(e: ElementoVista) {
    setQuitada({ id: e.id, texto: e.texto });
    setAnuncio(T.quitada(e.texto));
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => montado.current && setQuitada(null), MS_DESHACER);
    if (!(await marcar(e, "no_hace_falta"))) setQuitada(null);
  }

  async function recuperar(e: ElementoVista) {
    if (quitada?.id === e.id) setQuitada(null);
    setAnuncio(`${e.texto}: recuperado`);
    await marcar(e, "pendiente");
  }

  async function descartarRechazada(e: ElementoVista) {
    await colaPreparativos().descartar(claveMarca(planId, e.id));
    await refrescarOperaciones();
  }

  const fila = (e: ElementoVista) => (
    <li key={e.id} className="fila-preparativo" data-testid="preparativo" data-estado={e.estado} data-subida={e.subida}>
      <label className="casilla-preparativo">
        <input type="checkbox" checked={e.estado === "hecho"} onChange={() => void alternar(e)} />
        <span className={e.estado === "hecho" ? "texto-hecho" : undefined}>{e.texto}</span>
      </label>
      <p className="ayuda porque-preparativo">
        {T.porque} {e.porque}
        {e.fuente && (
          <>
            {" "}
            <a href={e.fuente.url} rel="noopener noreferrer">{T.fuente(e.fuente.titulo, e.fuente.revisado)}</a>
          </>
        )}
      </p>
      {(e.subida === "pendiente" || e.subida === "sin-sesion") && <span className="marca-pendiente" data-testid="preparativo-pendiente">{T.pendiente}</span>}
      {e.subida === "rechazada" && (
        <span role="alert" className="gasto-rechazado" data-testid="preparativo-rechazado">
          {T.rechazada}{" "}
          <button type="button" onClick={() => void descartarRechazada(e)}>{T.descartar}</button>
        </span>
      )}
      <button type="button" onClick={() => void quitar(e)}>{T.noMeHaceFalta}</button>
    </li>
  );

  return (
    <details className="seccion-preparativos pila" open={abierta} onToggle={(ev) => setAbierta(ev.currentTarget.open)}>
      <summary>
        <span className="titulo-preparativos">{T.titulo}</span>
        {datos && marcas !== null && <span className="ayuda" data-testid="preparativos-progreso">{T.progreso(hechos, total)}</span>}
        {porSubir > 0 && <span className="ayuda" data-testid="preparativos-sin-subir">{T.sinSubir(porSubir)}</span>}
      </summary>
      <p role="status" aria-live="polite" className="solo-lectores">{anuncio}</p>
      {!datos && (
        <p className="ayuda vacio-preparativos" data-testid="preparativos-generando">
          <svg aria-hidden="true" focusable="false" width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="7" width="14" height="14" rx="2" />
            <path d="M9 7V4h6v3M9 11v6M15 11v6" />
          </svg>
          {T.generando}
        </p>
      )}
      {datos && (
        <>
          {errorMarcas && (
            <p role="alert" data-testid="preparativos-error-marcas">
              {T.errorMarcas} <button type="button" onClick={() => void cargar()}>{T.reintentar}</button>
            </p>
          )}
          {copiaDe && <p className="ayuda" data-testid="preparativos-copia">{T.sinRed(new Date(copiaDe).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }))}</p>}
          {sinSesion > 0 && (
            <p role="alert" data-testid="preparativos-sin-sesion">
              {T.sinSesion}. <Link href="/viajes">{T.enlaceAcceso}</Link>
            </p>
          )}
          {errorEncolar && <p role="alert">{T.errorEncolar}</p>}
          {total > 0 && <progress value={hechos} max={total} aria-label={T.progreso(hechos, total)} />}
          {lista.length === 0 && <p className="ayuda">{T.vacia}</p>}
          {ORDEN.map((cat) => {
            const items = lista.filter((e) => e.categoria === cat && e.estado !== "no_hace_falta");
            if (items.length === 0) return null;
            return (
              <section key={cat} aria-label={T.categorias[cat]} className="pila">
                <h3>{T.categorias[cat]}</h3>
                <ul className="pila lista-preparativos">{items.map(fila)}</ul>
              </section>
            );
          })}
          {quitada && (
            <p role="status" className="fila" data-testid="preparativos-deshacer">
              <span>{T.quitada(quitada.texto)}</span>
              <button type="button" onClick={() => { const e = lista.find((x) => x.id === quitada.id); if (e) void recuperar(e); }}>{T.deshacer}</button>
            </p>
          )}
          {descartados.length > 0 && (
            <details className="pila" data-testid="preparativos-descartados">
              <summary>{T.quitadas(descartados.length)}</summary>
              <ul className="pila lista-preparativos">
                {descartados.map((e) => (
                  <li key={e.id} className="fila" data-testid="preparativo-descartado">
                    <span>{e.texto}</span>
                    {(e.subida === "pendiente" || e.subida === "sin-sesion") && <span className="marca-pendiente">{T.pendiente}</span>}
                    <button type="button" onClick={() => void recuperar(e)}>{T.recuperar}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </details>
  );
}
