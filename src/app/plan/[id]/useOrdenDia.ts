"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mismoOrden, moverParada, ordenDeParadas, type EntradaOrden } from "@/lib/plan/reordenar";
import type { PlanPublico } from "./tiposVista";

// Pausa tras la última pulsación: una ráfaga de botones es una sola versión.
export const ESPERA_AGRUPAR_MS = 1000;
export const DURACION_AVISO_MS = 10_000;

export const TEXTOS_ORDEN = {
  guardado: "Orden guardado",
  restaurado: "Orden restaurado",
  yaOptimo: "Este día ya va en el orden más corto",
  errorRed: "No se ha podido guardar el nuevo orden. Comprueba la conexión y vuelve a intentarlo.",
  desfasada: "Este plan ha cambiado en otra pantalla. Hemos cargado la versión más reciente; vuelve a ordenar si lo necesitas.",
  demasiados: "Has cambiado el orden muchas veces en poco tiempo. Espera unos minutos y vuelve a intentarlo.",
} as const;

export type EstadoOrden = "guardado" | "pendiente" | "guardando" | "error";

export interface AvisoOrden {
  texto: string;
  conDeshacer: boolean;
}

export interface OpcionesAplicar {
  // Sin esperar a la agrupación (Optimizar y Deshacer guardan al momento).
  inmediato?: boolean;
  // Texto del aviso al guardar; por defecto «Orden guardado».
  aviso?: string;
  // El aviso de un Deshacer no ofrece otro Deshacer.
  conDeshacer?: boolean;
}

export interface OrdenDia {
  ordenEnPantalla: (diaIndex: number) => EntradaOrden[];
  // Hay un cambio de este día sin confirmar por el servidor: sus horas y
  // tramos son los de antes.
  recalculando: (diaIndex: number) => boolean;
  mover: (diaIndex: number, id: string, direccion: "arriba" | "abajo") => void;
  aplicarOrden: (diaIndex: number, orden: EntradaOrden[], opciones?: OpcionesAplicar) => void;
  deshacer: () => void;
  // Aviso sin cambio guardado (p. ej. «ya va en el orden más corto»).
  informar: (texto: string) => void;
  reintentar: () => void;
  estado: EstadoOrden;
  mensaje?: string;
  aviso: AvisoOrden | null;
}

function sinDia(mapa: Record<number, EntradaOrden[]>, diaIndex: number): Record<number, EntradaOrden[]> {
  const copia = { ...mapa };
  delete copia[diaIndex];
  return copia;
}

interface Intento {
  diaIndex: number;
  orden: EntradaOrden[];
  opciones: OpcionesAplicar;
}

// Único sitio que llama a POST /api/plan/[id]/orden: los botones, Optimizar y
// el arrastre solo piden un orden. El plan que devuelve el servidor sustituye
// al de la pantalla, así horas, tramos, paseo y «sal a las» salen del mismo
// código de siempre.
export function useOrdenDia(plan: PlanPublico, alActualizar: (plan: PlanPublico) => void): OrdenDia {
  const [pendientes, setPendientes] = useState<Record<number, EntradaOrden[]>>({});
  const [estado, setEstado] = useState<EstadoOrden>("guardado");
  const [mensaje, setMensaje] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<AvisoOrden | null>(null);

  // Refs con lo último: los temporizadores y las respuestas tardías no
  // pueden leer el estado de un render viejo.
  const planRef = useRef(plan);
  const pendientesRef = useRef(pendientes);
  const opcionesRef = useRef<Record<number, OpcionesAplicar>>({});
  const temporizadores = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const guardando = useRef(false);
  const aGuardarDespues = useRef<Set<number>>(new Set());
  const ultimo = useRef<{ diaIndex: number; anterior: EntradaOrden[] } | null>(null);
  const fallido = useRef<Intento | null>(null);
  const temporizadorAviso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alActualizarRef = useRef(alActualizar);
  useEffect(() => {
    planRef.current = plan;
    alActualizarRef.current = alActualizar;
  });

  function fijarPendientes(siguiente: Record<number, EntradaOrden[]>) {
    pendientesRef.current = siguiente;
    setPendientes(siguiente);
  }

  const mostrarAviso = useCallback((nuevo: AvisoOrden | null) => {
    if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current);
    temporizadorAviso.current = null;
    setAviso(nuevo);
    if (nuevo) temporizadorAviso.current = setTimeout(() => setAviso(null), DURACION_AVISO_MS);
  }, []);

  const guardadoDe = useCallback((diaIndex: number): EntradaOrden[] => ordenDeParadas(planRef.current.dias[diaIndex]?.paradas ?? []), []);

  const guardar = useCallback(
    async (diaIndex: number): Promise<void> => {
      const orden = pendientesRef.current[diaIndex];
      if (!orden) return;
      if (guardando.current) {
        aGuardarDespues.current.add(diaIndex);
        return;
      }
      const anterior = guardadoDe(diaIndex);
      const opciones = opcionesRef.current[diaIndex] ?? {};
      delete opcionesRef.current[diaIndex];
      if (mismoOrden(anterior, orden)) {
        fijarPendientes(sinDia(pendientesRef.current, diaIndex));
        setEstado("guardado");
        return;
      }

      guardando.current = true;
      setEstado("guardando");
      const plan = planRef.current;
      const recuperarTrasFallo = (texto: string) => {
        fijarPendientes(sinDia(pendientesRef.current, diaIndex));
        setMensaje(texto);
        setEstado("error");
      };
      try {
        const respuesta = await fetch(`/api/plan/${plan.id}/orden`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version_base: plan.version, dia_index: diaIndex, orden }),
        });
        if (respuesta.ok) {
          const datos = (await respuesta.json()) as { plan: PlanPublico };
          alActualizarRef.current(datos.plan);
          planRef.current = datos.plan;
          // Si mientras se guardaba llegó otra pulsación, la pantalla conserva
          // ese orden más nuevo y se guardará en su turno.
          if (pendientesRef.current[diaIndex] && mismoOrden(pendientesRef.current[diaIndex], orden)) {
            fijarPendientes(sinDia(pendientesRef.current, diaIndex));
          }
          ultimo.current = { diaIndex, anterior };
          fallido.current = null;
          setMensaje(undefined);
          setEstado(Object.keys(pendientesRef.current).length > 0 ? "pendiente" : "guardado");
          mostrarAviso({ texto: opciones.aviso ?? TEXTOS_ORDEN.guardado, conDeshacer: opciones.conDeshacer ?? true });
          // La copia sin conexión es la respuesta de GET /api/plan/[id]: pedirla
          // otra vez la deja con el orden nuevo sin escribir en la caché a mano.
          void fetch(`/api/plan/${plan.id}`).catch(() => undefined);
        } else if (respuesta.status === 409) {
          recuperarTrasFallo(TEXTOS_ORDEN.desfasada);
          const ultima = await fetch(`/api/plan/${plan.id}`);
          if (ultima.ok) {
            const nueva = (await ultima.json()) as PlanPublico;
            planRef.current = nueva;
            alActualizarRef.current(nueva);
          }
        } else if (respuesta.status === 429) {
          recuperarTrasFallo(TEXTOS_ORDEN.demasiados);
        } else {
          fallido.current = { diaIndex, orden, opciones };
          recuperarTrasFallo(TEXTOS_ORDEN.errorRed);
        }
      } catch {
        fallido.current = { diaIndex, orden, opciones };
        recuperarTrasFallo(TEXTOS_ORDEN.errorRed);
      } finally {
        guardando.current = false;
        const siguientes = [...aGuardarDespues.current];
        aGuardarDespues.current.clear();
        for (const d of siguientes) void guardar(d);
      }
    },
    [guardadoDe, mostrarAviso],
  );

  const aplicarOrden = useCallback(
    (diaIndex: number, orden: EntradaOrden[], opciones: OpcionesAplicar = {}) => {
      fijarPendientes({ ...pendientesRef.current, [diaIndex]: orden });
      opcionesRef.current[diaIndex] = { ...opcionesRef.current[diaIndex], ...opciones };
      setEstado("pendiente");
      setMensaje(undefined);
      mostrarAviso(null);
      if (temporizadores.current[diaIndex]) clearTimeout(temporizadores.current[diaIndex]);
      if (opciones.inmediato) {
        delete temporizadores.current[diaIndex];
        void guardar(diaIndex);
      } else {
        temporizadores.current[diaIndex] = setTimeout(() => {
          delete temporizadores.current[diaIndex];
          void guardar(diaIndex);
        }, ESPERA_AGRUPAR_MS);
      }
    },
    [guardar, mostrarAviso],
  );

  const ordenEnPantalla = useCallback((diaIndex: number) => pendientes[diaIndex] ?? ordenDeParadas(plan.dias[diaIndex]?.paradas ?? []), [pendientes, plan]);

  const mover = useCallback(
    (diaIndex: number, id: string, direccion: "arriba" | "abajo") => {
      const base = pendientesRef.current[diaIndex] ?? guardadoDe(diaIndex);
      const nuevo = moverParada(base, id, direccion);
      if (mismoOrden(base, nuevo)) return;
      aplicarOrden(diaIndex, nuevo);
    },
    [aplicarOrden, guardadoDe],
  );

  const deshacer = useCallback(() => {
    const previo = ultimo.current;
    if (!previo) return;
    ultimo.current = null;
    aplicarOrden(previo.diaIndex, previo.anterior, { inmediato: true, aviso: TEXTOS_ORDEN.restaurado, conDeshacer: false });
  }, [aplicarOrden]);

  const informar = useCallback((texto: string) => mostrarAviso({ texto, conDeshacer: false }), [mostrarAviso]);

  const reintentar = useCallback(() => {
    const intento = fallido.current;
    if (!intento) return;
    fallido.current = null;
    aplicarOrden(intento.diaIndex, intento.orden, { ...intento.opciones, inmediato: true });
  }, [aplicarOrden]);

  useEffect(() => {
    const t = temporizadores.current;
    return () => {
      for (const clave of Object.keys(t)) clearTimeout(t[Number(clave)]);
      if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current);
    };
  }, []);

  const recalculando = useCallback((diaIndex: number) => pendientes[diaIndex] !== undefined, [pendientes]);

  return { ordenEnPantalla, recalculando, mover, aplicarOrden, deshacer, informar, reintentar, estado, mensaje, aviso };
}
