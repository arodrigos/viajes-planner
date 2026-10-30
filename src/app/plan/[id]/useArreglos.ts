"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { etiquetaDiaCorta, moverParadaDeDia, ordenConParadaEnFranja, type MovimientoDia } from "@/lib/plan/aplicarArreglo";
import type { ArregloPropuesto } from "@/lib/plan/arreglos";
import { ordenDeParadas, type EntradaOrden } from "@/lib/plan/reordenar";
import { TEXTOS_ARREGLOS } from "@/lib/textos/arreglos";
import type { DiaPublico, PlanPublico } from "./tiposVista";

export const DURACION_AVISO_ARREGLO_MS = 8_000;

function pareceUnPlan(datos: unknown): datos is PlanPublico {
  if (typeof datos !== "object" || datos === null) return false;
  const { version, dias } = datos as { version?: unknown; dias?: unknown };
  return typeof version === "number" && Number.isFinite(version) && Array.isArray(dias);
}

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
  | { tipo: "mover-dia"; movimiento: MovimientoDia; deshacer?: boolean }
  | { tipo: "orden"; diaIndex: number; orden: EntradaOrden[]; deshacer?: boolean }
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
  const inverso = useRef<Operacion | null>(null);
  // Los envíos salen de uno en uno y en el orden en que se tocaron, cada uno con
  // la versión que devolvió el anterior. Tocar mientras otro guarda se encadena
  // detrás: nunca se descarta un toque en silencio.
  const cola = useRef<Promise<void>>(Promise.resolve());
  const pendientes = useRef(0);
  // Si un envío falla, los que iban detrás partían de un plan que ya no existe:
  // no se mandan y la pantalla queda como la dejó la reversión del fallido.
  const fallos = useRef(0);
  // Cada toque sube la época: un releer() lanzado antes no debe volver a pintar
  // un plan anterior al cambio optimista.
  const epoca = useRef(0);
  // Última versión que el servidor confirmó en una respuesta. El plan de props
  // no la alcanza hasta que releer() termina: sin esta ref, el efecto de abajo
  // pisaba la versión del POST en cada render y el inverso salía con la vieja (409).
  const versionConfirmada = useRef(plan.version);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    planRef.current = plan.version < versionConfirmada.current ? { ...plan, version: versionConfirmada.current } : plan;
    versionConfirmada.current = Math.max(versionConfirmada.current, plan.version);
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

  const releer = useCallback(async (forzar = false): Promise<PlanPublico | null> => {
    const mia = epoca.current;
    if (!forzar && pendientes.current > 0) return null;
    try {
      const r = await fetch(`/api/plan/${planRef.current.id}`);
      if (!r.ok) return null;
      const nuevo: unknown = await r.json();
      // Un cuerpo sin versión numérica dejaba NaN en versionConfirmada y el
      // siguiente envío salía sin version_base válida: se trata como un fallo.
      if (!pareceUnPlan(nuevo)) return null;
      if (!forzar && (mia !== epoca.current || pendientes.current > 0)) return null;
      versionConfirmada.current = Math.max(versionConfirmada.current, nuevo.version);
      planRef.current = nuevo;
      alActualizarRef.current(nuevo);
      return nuevo;
    } catch {
      return null;
    }
  }, []);

  const enviar = useCallback(async (operacion: Operacion): Promise<Resultado> => {
    const { id } = planRef.current;
    const version = Math.max(planRef.current.version, versionConfirmada.current);
    let url = "";
    let cuerpo: Record<string, unknown>;
    if (operacion.tipo === "mover-dia") {
      const m = operacion.movimiento;
      url = `/api/plan/${id}/paradas/${m.paradaId}/mover-dia`;
      cuerpo = { version_base: version, dia_origen: m.diaOrigen, dia_destino: m.diaDestino, franja_id: m.franjaId, ...(operacion.deshacer ? { deshacer: true } : {}), ...(m.posicion !== undefined ? { posicion: m.posicion } : {}) };
    } else if (operacion.tipo === "orden") {
      url = `/api/plan/${id}/orden`;
      cuerpo = { version_base: version, dia_index: operacion.diaIndex, orden: operacion.orden, ...(operacion.deshacer ? { deshacer: true } : {}) };
    } else {
      url = `/api/plan/${id}/paradas/${operacion.paradaId}/sustituir`;
      cuerpo = { alternativa_id: operacion.alternativaId };
    }
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      if (r.ok) {
        // La versión nueva viene en la propia respuesta: así el siguiente envío
        // (Deshacer) no espera a releer el plan entero.
        const datos = (await r.json().catch(() => null)) as { version?: unknown; plan?: { version?: unknown } } | null;
        const nueva = datos?.version ?? datos?.plan?.version;
        if (typeof nueva === "number") {
          versionConfirmada.current = Math.max(versionConfirmada.current, nueva);
          planRef.current = { ...planRef.current, version: versionConfirmada.current };
        }
        return "ok";
      }
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
      // El servidor conserva lo ya confirmado: el plan revertido no debe bajar la versión.
      const vuelto = antes.version < versionConfirmada.current ? { ...antes, version: versionConfirmada.current } : antes;
      alActualizarRef.current(vuelto);
      planRef.current = vuelto;
      if (resultado === "desfasada") {
        setError(TEXTOS_ARREGLOS.desfasada.texto);
        await releer(true);
      } else {
        setError(resultado === "demasiados" ? TEXTOS_ARREGLOS.demasiados.texto : TEXTOS_ARREGLOS.errorRed.texto);
      }
    },
    [releer],
  );

  const encolar = useCallback(
    (operacion: Operacion, antes: PlanPublico): Promise<Resultado | "omitida"> => {
      const generacion = fallos.current;
      pendientes.current += 1;
      setOcupado(true);
      const tarea = cola.current.then(async (): Promise<Resultado | "omitida"> => {
        if (fallos.current !== generacion) return "omitida";
        const resultado = await enviar(operacion);
        if (resultado !== "ok") {
          fallos.current += 1;
          inverso.current = null;
          mostrarAviso(null);
          await fallar(resultado, antes);
        }
        return resultado;
      });
      cola.current = tarea.then(
        () => undefined,
        () => undefined,
      );
      return tarea.finally(() => {
        pendientes.current -= 1;
        if (pendientes.current === 0) setOcupado(false);
      });
    },
    [enviar, fallar, mostrarAviso],
  );

  const aplicar = useCallback(
    async (arreglo: ArregloPropuesto, paradaId: string, diaIndex: number) => {
      epoca.current += 1;
      setError(null);
      mostrarAviso(null);
      const antes = planRef.current;
      const dia = antes.dias[diaIndex];
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
        texto = rellenar(TEXTOS_ARREGLOS.cambiada.texto, "nombre", elegida?.nombre ?? "");
        const resultado = await encolar({ tipo: "sustituir", paradaId, alternativaId: arreglo.alternativaId }, antes);
        if (resultado !== "ok") return;
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
      const resultado = await encolar(operacion, antes);
      if (resultado === "ok") await releer();
    },
    [encolar, mostrarAviso, pintar, releer],
  );

  const deshacer = useCallback(() => {
    const previa = inverso.current;
    if (!previa) return;
    // «sustituir» no tiene tope por hora; el resto marca el inverso para usar la versión reservada.
    const operacion: Operacion = previa.tipo === "sustituir" ? previa : { ...previa, deshacer: true };
    inverso.current = null;
    const mia = (epoca.current += 1);
    setError(null);
    mostrarAviso(null);
    // Se pinta ya, sin esperar al guardado del arreglo; si ese falla, su propia
    // reversión devuelve el plan de antes y el inverso no llega a enviarse.
    // `antes` es el plan con el arreglo aplicado: a él se vuelve si falla el inverso.
    const antes = planRef.current;
    pintar(operacion);
    void (async () => {
      const resultado = await encolar(operacion, antes);
      if (resultado !== "ok") return;
      await releer();
      if (epoca.current === mia) mostrarAviso({ texto: TEXTOS_ARREGLOS.restaurada.texto, conDeshacer: false });
    })();
  }, [encolar, mostrarAviso, pintar, releer]);

  return { aplicar, deshacer, aviso, error, ocupado };
}
