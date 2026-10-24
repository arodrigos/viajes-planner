"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { etiquetaDiaCorta, moverParadaDeDia, ordenConParadaEnFranja, type MovimientoDia } from "@/lib/plan/aplicarArreglo";
import type { ArregloPropuesto } from "@/lib/plan/arreglos";
import { ordenDeParadas, type EntradaOrden } from "@/lib/plan/reordenar";
import { TEXTOS_ARREGLOS } from "@/lib/textos/arreglos";
import type { DiaPublico, PlanPublico } from "./tiposVista";

export const DURACION_AVISO_ARREGLO_MS = 8_000;

export interface AvisoArreglo {
  texto: string;
  conDeshacer: boolean;
}

export interface Arreglos {
  aplicar: (arreglo: ArregloPropuesto, paradaId: string, diaIndex: number) => Promise<void>;
  deshacer: () => void;
  aviso: AvisoArreglo | null;
  error: string | null;
  ocupado: boolean;
}

type Operacion =
  | { tipo: "mover-dia"; movimiento: MovimientoDia }
  | { tipo: "orden"; diaIndex: number; orden: EntradaOrden[] }
  | { tipo: "sustituir"; paradaId: string; alternativaId: string };

type Resultado = "ok" | "desfasada" | "demasiados" | "error";

const conArticulo = (etiqueta: string) => `la ${etiqueta.toLowerCase()}`;
const rellenar = (plantilla: string, clave: string, valor: string) => plantilla.replace(`{${clave}}`, valor);

// Las horas de una parada movida ya no valen hasta que el servidor las recalcule.
function sinHorario<P extends { horario?: unknown }>(parada: P): P {
  const { horario: _horario, ...resto } = parada;
  return resto as P;
}

// Único sitio que llama a «mover-dia»; «Otra franja» y «Alternativa» reutilizan
// /orden y /sustituir, que ya tienen su propio tope, versión y pruebas. Se pinta
// el cambio al instante y, si el servidor lo rechaza, se vuelve al plan de antes.
export function useArreglos(plan: PlanPublico, alActualizar: (plan: PlanPublico) => void): Arreglos {
  const [aviso, setAviso] = useState<AvisoArreglo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const planRef = useRef(plan);
  const alActualizarRef = useRef(alActualizar);
  const enCurso = useRef(false);
  const inverso = useRef<Operacion | null>(null);
  // Resuelve cuando el servidor confirma (true) o rechaza (false) el arreglo en
  // vuelo: «Deshacer» ya se ofrece antes y espera aquí para usar la versión nueva.
  const vuelo = useRef<Promise<boolean> | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    planRef.current = plan;
    alActualizarRef.current = alActualizar;
  });
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const mostrarAviso = useCallback((nuevo: AvisoArreglo | null) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    setAviso(nuevo);
    if (nuevo) temporizador.current = setTimeout(() => setAviso(null), DURACION_AVISO_ARREGLO_MS);
  }, []);

  const releer = useCallback(async (): Promise<PlanPublico | null> => {
    try {
      const r = await fetch(`/api/plan/${planRef.current.id}`);
      if (!r.ok) return null;
      const nuevo = (await r.json()) as PlanPublico;
      planRef.current = nuevo;
      alActualizarRef.current(nuevo);
      return nuevo;
    } catch {
      return null;
    }
  }, []);

  const enviar = useCallback(async (operacion: Operacion): Promise<Resultado> => {
    const { id, version } = planRef.current;
    let url = "";
    let cuerpo: Record<string, unknown>;
    if (operacion.tipo === "mover-dia") {
      const m = operacion.movimiento;
      url = `/api/plan/${id}/paradas/${m.paradaId}/mover-dia`;
      cuerpo = { version_base: version, dia_origen: m.diaOrigen, dia_destino: m.diaDestino, franja_id: m.franjaId, ...(m.posicion !== undefined ? { posicion: m.posicion } : {}) };
    } else if (operacion.tipo === "orden") {
      url = `/api/plan/${id}/orden`;
      cuerpo = { version_base: version, dia_index: operacion.diaIndex, orden: operacion.orden };
    } else {
      url = `/api/plan/${id}/paradas/${operacion.paradaId}/sustituir`;
      cuerpo = { alternativa_id: operacion.alternativaId };
    }
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      if (r.ok) return "ok";
      if (r.status === 409) return "desfasada";
      if (r.status === 429) return "demasiados";
      return "error";
    } catch {
      return "error";
    }
  }, []);

  // Pinta el efecto de la operación sobre el plan de la pantalla (nada para
  // «sustituir», cuyo resultado solo lo conoce el servidor) y devuelve cómo deshacerla.
  const pintar = useCallback((operacion: Operacion): Operacion | null => {
    const actual = planRef.current;
    if (operacion.tipo === "mover-dia") {
      const hecho = moverParadaDeDia<DiaPublico>(actual.dias, operacion.movimiento, sinHorario);
      if (!hecho) return null;
      alActualizarRef.current({ ...actual, dias: hecho.dias });
      return { tipo: "mover-dia", movimiento: hecho.inverso };
    }
    if (operacion.tipo === "orden") {
      const dia = actual.dias[operacion.diaIndex];
      if (!dia) return null;
      const anterior = ordenDeParadas(dia.paradas);
      const porId = new Map(dia.paradas.map((p) => [p.id, p]));
      const paradas = operacion.orden.flatMap((e) => {
        const p = porId.get(e.id);
        return p ? [sinHorario({ ...p, franja_id: e.franja_id })] : [];
      });
      alActualizarRef.current({ ...actual, dias: actual.dias.map((d, i) => (i === operacion.diaIndex ? { ...d, paradas } : d)) });
      return { tipo: "orden", diaIndex: operacion.diaIndex, orden: anterior };
    }
    return null;
  }, []);

  const fallar = useCallback(
    async (resultado: Exclude<Resultado, "ok">, antes: PlanPublico) => {
      alActualizarRef.current(antes);
      planRef.current = antes;
      if (resultado === "desfasada") {
        setError(TEXTOS_ARREGLOS.desfasada.texto);
        await releer();
      } else {
        setError(resultado === "demasiados" ? TEXTOS_ARREGLOS.demasiados.texto : TEXTOS_ARREGLOS.errorRed.texto);
      }
    },
    [releer],
  );

  const aplicar = useCallback(
    async (arreglo: ArregloPropuesto, paradaId: string, diaIndex: number) => {
      if (enCurso.current) return;
      enCurso.current = true;
      setOcupado(true);
      setError(null);
      mostrarAviso(null);
      const antes = planRef.current;
      const dia = antes.dias[diaIndex];
      let confirmado = false;
      let cerrarVuelo: (ok: boolean) => void = () => {};
      vuelo.current = new Promise<boolean>((resolver) => {
        cerrarVuelo = resolver;
      });
      try {
        let operacion: Operacion;
        let texto: string;
        if (arreglo.tipo === "otra-franja") {
          if (!dia) return;
          operacion = { tipo: "orden", diaIndex, orden: ordenConParadaEnFranja(dia, paradaId, arreglo.franjaId) };
          const franja = dia.franjas.find((f) => f.id === arreglo.franjaId);
          texto = rellenar(TEXTOS_ARREGLOS.movidaA.texto, "franja", conArticulo(franja?.etiqueta ?? arreglo.franjaId));
        } else if (arreglo.tipo === "otro-dia") {
          const destino = antes.dias[arreglo.diaDestino];
          if (!destino) return;
          operacion = { tipo: "mover-dia", movimiento: { diaOrigen: diaIndex, diaDestino: arreglo.diaDestino, paradaId, franjaId: arreglo.franjaId } };
          texto = rellenar(TEXTOS_ARREGLOS.movidaAl.texto, "dia", etiquetaDiaCorta(destino.fecha));
        } else {
          const original = dia?.paradas.find((p) => p.id === paradaId);
          const nombreOriginal = original?.nombre;
          const elegida = original?.alternativas?.find((a) => a.id === arreglo.alternativaId);
          operacion = { tipo: "sustituir", paradaId, alternativaId: arreglo.alternativaId };
          texto = rellenar(TEXTOS_ARREGLOS.cambiada.texto, "nombre", elegida?.nombre ?? "");
          const resultado = await enviar(operacion);
          if (resultado !== "ok") return await fallar(resultado, antes);
          // La parada original queda entre las alternativas de la nueva: de ahí sale el Deshacer.
          const fresco = await releer();
          const vuelta = fresco?.dias[diaIndex]?.paradas.find((p) => p.id === paradaId)?.alternativas?.find((a) => a.nombre === nombreOriginal);
          inverso.current = vuelta?.id ? { tipo: "sustituir", paradaId, alternativaId: vuelta.id } : null;
          mostrarAviso({ texto, conDeshacer: inverso.current !== null });
          return;
        }
        // El aviso sale en el mismo frame que el cambio pintado: esperar al
        // servidor y a releer el plan lo retrasaba 4-5 s (límite de 200 ms).
        const deshecho = pintar(operacion);
        inverso.current = deshecho;
        mostrarAviso({ texto, conDeshacer: deshecho !== null });
        const resultado = await enviar(operacion);
        if (resultado !== "ok") {
          inverso.current = null;
          mostrarAviso(null);
          return await fallar(resultado, antes);
        }
        confirmado = true;
        await releer();
      } finally {
        cerrarVuelo(confirmado);
        vuelo.current = null;
        enCurso.current = false;
        setOcupado(false);
      }
    },
    [enviar, fallar, mostrarAviso, pintar, releer],
  );

  const deshacer = useCallback(() => {
    const operacion = inverso.current;
    if (!operacion || (enCurso.current && !vuelo.current)) return;
    inverso.current = null;
    const pendiente = vuelo.current;
    void (async () => {
      // Si el arreglo aún se está guardando se espera a su confirmación; si
      // falló, ya se revirtió solo y no hay nada que deshacer.
      if (pendiente && !(await pendiente)) return;
      enCurso.current = true;
      setOcupado(true);
      setError(null);
      mostrarAviso(null);
      const antes = planRef.current;
      try {
        pintar(operacion);
        const resultado = await enviar(operacion);
        if (resultado !== "ok") return await fallar(resultado, antes);
        await releer();
        mostrarAviso({ texto: TEXTOS_ARREGLOS.restaurada.texto, conDeshacer: false });
      } finally {
        enCurso.current = false;
        setOcupado(false);
      }
    })();
  }, [enviar, fallar, mostrarAviso, pintar, releer]);

  return { aplicar, deshacer, aviso, error, ocupado };
}
