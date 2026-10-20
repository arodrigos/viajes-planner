"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MENSAJES_SITIO } from "@/lib/plan/sitiosPropios";
import type { DiaPublico, ParadaPublica } from "./tiposVista";

export const DURACION_AVISO_SITIO_MS = 8000;

export const TEXTOS_SITIO = {
  anadido: "Sitio añadido",
  quitado: "Sitio quitado",
} as const;

// Lo que se enseña antes de que el servidor confirme. Está atado al `dia` del
// servidor sobre el que se hizo: cuando llega el plan nuevo la referencia
// cambia y todo esto deja de aplicarse solo, igual que los nombres provisionales
// de las alternativas.
interface Provisional {
  dia: DiaPublico;
  anadidos: ParadaPublica[];
  corregidos: Record<string, string>;
  quitados: string[];
}

export interface AvisoSitio {
  texto: string;
  // Solo el alta se deshace, y solo cuando ya se sabe su id.
  idExterno: string | null;
}

export interface SitiosPropios {
  anadidos: ParadaPublica[];
  corregidos: Record<string, string>;
  quitados: ReadonlySet<string>;
  aviso: AvisoSitio | null;
  error: string | null;
  anadir: (nombre: string, nota: string | null) => void;
  corregir: (idExterno: string, nombre: string) => Promise<boolean>;
  quitar: (idExterno: string) => Promise<boolean>;
  deshacer: () => void;
}

async function mensajeDe(respuesta: Response): Promise<string> {
  const datos = (await respuesta.json().catch(() => null)) as { error?: unknown } | null;
  const previsto = [400, 409, 429].includes(respuesta.status) && typeof datos?.error === "string" && datos.error.length <= 200;
  return previsto ? (datos!.error as string) : MENSAJES_SITIO.interno;
}

// Único sitio que llama a /api/plan/[id]/sitios: pinta el cambio al momento y
// lo confirma después. Las peticiones van en fila, cada una con la versión que
// devolvió la anterior; dos altas seguidas con la misma versión base darían 409.
export function useSitiosPropios(planId: string, version: number, indiceDia: number, diaServidor: DiaPublico, onPlanActualizado: () => void): SitiosPropios {
  const [provisional, setProvisional] = useState<Provisional | null>(null);
  const [aviso, setAviso] = useState<AvisoSitio | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versionRef = useRef(version);
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  const contador = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    versionRef.current = Math.max(versionRef.current, version);
  }, [version]);
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const cambiar = useCallback(
    (cambio: (base: Provisional) => Provisional) => {
      setProvisional((previo) => cambio(previo?.dia === diaServidor ? previo : { dia: diaServidor, anadidos: [], corregidos: {}, quitados: [] }));
    },
    [diaServidor],
  );

  const mostrarAviso = useCallback((nuevo: AvisoSitio | null) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    setAviso(nuevo);
    if (nuevo) temporizador.current = setTimeout(() => setAviso(null), DURACION_AVISO_SITIO_MS);
  }, []);

  const enFila = useCallback(<T,>(tarea: () => Promise<T>): Promise<T> => {
    const siguiente = cola.current.then(tarea, tarea);
    cola.current = siguiente.catch(() => undefined);
    return siguiente;
  }, []);

  // Una petición con versión base: devuelve la versión nueva o el mensaje del fallo.
  const llamar = useCallback(
    async (url: string, metodo: "POST" | "PATCH" | "DELETE", cuerpo?: Record<string, unknown>): Promise<{ ok: true; datos: { version: number; id_externo?: string } } | { ok: false; mensaje: string }> => {
      try {
        const respuesta = await fetch(url, {
          method: metodo,
          ...(cuerpo ? { headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) } : {}),
        });
        if (!respuesta.ok) return { ok: false, mensaje: await mensajeDe(respuesta) };
        const datos = (await respuesta.json()) as { version: number; id_externo?: string };
        versionRef.current = Math.max(versionRef.current, datos.version);
        return { ok: true, datos };
      } catch {
        return { ok: false, mensaje: MENSAJES_SITIO.interno };
      }
    },
    [],
  );

  const anadir = useCallback(
    (nombre: string, nota: string | null) => {
      const idProvisional = `nuevo-${++contador.current}`;
      const ultimaFranja = diaServidor.franjas[diaServidor.franjas.length - 1]?.id ?? "";
      const parada: ParadaPublica = {
        id: idProvisional,
        franja_id: ultimaFranja,
        nombre,
        descripcion: "",
        procedencia: { fuente: "propuesto-sin-verificar" },
        propia: true,
        estadoSitio: "buscando",
        ...(nota ? { nota } : {}),
      };
      setError(null);
      cambiar((base) => ({ ...base, anadidos: [...base.anadidos, parada] }));
      mostrarAviso({ texto: TEXTOS_SITIO.anadido, idExterno: null });
      void enFila(async () => {
        const resultado = await llamar(`/api/plan/${planId}/sitios`, "POST", { dia: indiceDia, nombre, nota, version_base: versionRef.current });
        if (!resultado.ok) {
          cambiar((base) => ({ ...base, anadidos: base.anadidos.filter((a) => a.id !== idProvisional) }));
          mostrarAviso(null);
          setError(resultado.mensaje);
          return;
        }
        // La tarjeta provisional toma el id real para que el Deshacer sepa a cuál apunta.
        cambiar((base) => ({ ...base, anadidos: base.anadidos.map((a) => (a.id === idProvisional ? { ...a, id: resultado.datos.id_externo ?? a.id } : a)) }));
        setAviso((previo) => (previo ? { ...previo, idExterno: resultado.datos.id_externo ?? null } : previo));
        onPlanActualizado();
      });
    },
    [cambiar, diaServidor.franjas, enFila, indiceDia, llamar, mostrarAviso, onPlanActualizado, planId],
  );

  const corregir = useCallback(
    (idExterno: string, nombre: string) => {
      setError(null);
      cambiar((base) => ({ ...base, corregidos: { ...base.corregidos, [idExterno]: nombre } }));
      return enFila(async () => {
        const resultado = await llamar(`/api/plan/${planId}/sitios/${encodeURIComponent(idExterno)}`, "PATCH", { nombre, version_base: versionRef.current });
        if (!resultado.ok) {
          cambiar((base) => ({ ...base, corregidos: Object.fromEntries(Object.entries(base.corregidos).filter(([id]) => id !== idExterno)) }));
          setError(resultado.mensaje);
          return false;
        }
        onPlanActualizado();
        return true;
      });
    },
    [cambiar, enFila, llamar, onPlanActualizado, planId],
  );

  const quitar = useCallback(
    (idExterno: string) => {
      setError(null);
      cambiar((base) => ({ ...base, quitados: [...base.quitados, idExterno] }));
      return enFila(async () => {
        const resultado = await llamar(`/api/plan/${planId}/sitios/${encodeURIComponent(idExterno)}?version_base=${versionRef.current}`, "DELETE");
        if (!resultado.ok) {
          cambiar((base) => ({ ...base, quitados: base.quitados.filter((q) => q !== idExterno) }));
          setError(resultado.mensaje);
          return false;
        }
        onPlanActualizado();
        return true;
      });
    },
    [cambiar, enFila, llamar, onPlanActualizado, planId],
  );

  const deshacer = useCallback(() => {
    const id = aviso?.idExterno;
    if (!id) return;
    mostrarAviso({ texto: TEXTOS_SITIO.quitado, idExterno: null });
    void quitar(id);
  }, [aviso, mostrarAviso, quitar]);

  const vigente = provisional?.dia === diaServidor ? provisional : null;
  return {
    // Quitar un alta recién hecha (Deshacer) la oculta aunque el plan aún no se haya releído.
    anadidos: (vigente?.anadidos ?? []).filter((a) => !vigente?.quitados.includes(a.id)),
    corregidos: vigente?.corregidos ?? {},
    quitados: new Set(vigente?.quitados ?? []),
    aviso,
    error,
    anadir,
    corregir,
    quitar,
    deshacer,
  };
}
