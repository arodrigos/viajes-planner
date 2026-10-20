"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { describirDias, diasConMapa, diasGuardados, estimarMB, estimarPlan, guardarMapasPlan, teselasDelDia } from "@/lib/sinConexion/mapas";
import type { MotivoFallo, PlanParaMapa } from "@/lib/sinConexion/mapas";

type Estado =
  | { tipo: "reposo" }
  | { tipo: "calculando" }
  | { tipo: "guardando"; dia: number; total: number }
  | { tipo: "fin"; fallo?: MotivoFallo; guardados: number };

const TEXTO_FALLO: Record<MotivoFallo, string> = {
  servidor: "El servidor de mapas ha pedido parar; inténtalo más tarde.",
  red: "No se pudo descargar el mapa. Comprueba la conexión e inténtalo de nuevo.",
  cancelado: "Guardado cancelado.",
  almacenamiento: "No hay espacio para guardar más mapas en este dispositivo.",
};

function mbDeDias(plan: PlanParaMapa, dias: number[]): number {
  const teselas = dias.reduce((n, d) => {
    const puntos = (plan.dias[d - 1]?.paradas ?? []).flatMap((p) => (p.coordenadas ? [p.coordenadas] : []));
    return n + teselasDelDia(puntos).length;
  }, 0);
  return estimarMB(teselas);
}

// El mapa solo se descarga cuando la persona pulsa el botón. El aviso de días
// guardados se recalcula contra la caché real cada vez que puede haber
// cambiado (abrir, terminar, volver a la pestaña, cambiar la conexión).
// Sobre una copia guardada (sin red) solo se enseña el aviso: guardar necesita red.
export function GuardarMapas({ planId, dias: diasPlan, puedeGuardar = true }: { planId: string; dias: PlanParaMapa["dias"]; puedeGuardar?: boolean }) {
  // Referencia estable mientras el plan no cambie: el efecto de abajo no se repite.
  const plan = useMemo<PlanParaMapa>(() => ({ id: planId, dias: diasPlan }), [planId, diasPlan]);
  const [enLinea, setEnLinea] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [guardados, setGuardados] = useState<number[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "reposo" });
  const cancelar = useRef<AbortController | null>(null);

  // Estado en vivo: se relee de la caché cuando puede haber cambiado.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vivo = true;
    void diasGuardados(plan).then((d) => {
      if (vivo) setGuardados(d);
    });
    return () => {
      vivo = false;
    };
  }, [plan, version]);
  useEffect(() => {
    const alCambiar = () => {
      setEnLinea(navigator.onLine);
      setVersion((v) => v + 1);
    };
    window.addEventListener("online", alCambiar);
    window.addEventListener("offline", alCambiar);
    document.addEventListener("visibilitychange", alCambiar);
    return () => {
      window.removeEventListener("online", alCambiar);
      window.removeEventListener("offline", alCambiar);
      document.removeEventListener("visibilitychange", alCambiar);
    };
  }, []);

  if (diasConMapa(plan).length === 0) return null;
  const { dias, mb } = estimarPlan(plan);
  const ocupado = estado.tipo === "calculando" || estado.tipo === "guardando";

  async function guardar() {
    // El estado pendiente se pinta antes de cualquier espera.
    setEstado({ tipo: "calculando" });
    const control = new AbortController();
    cancelar.current = control;
    const resultado = await guardarMapasPlan(plan, {
      señal: control.signal,
      alProgreso: ({ dia, total }) => setEstado({ tipo: "guardando", dia, total }),
    });
    cancelar.current = null;
    setEstado({ tipo: "fin", fallo: resultado.fallo?.motivo, guardados: resultado.guardados.length });
    setVersion((v) => v + 1);
  }

  return (
    <div className="guardar-mapas pila">
      {guardados.length > 0 && (
        <p role="status" className="ayuda aviso-mapas-guardados">
          Guardado para usar sin red: días {describirDias(guardados)} (≈{mbDeDias(plan, guardados)} MB)
        </p>
      )}
      {enLinea && puedeGuardar && (
        <>
          {!ocupado && (
            <button type="button" className="boton" onClick={() => void guardar()}>
              Guardar mapas para usar sin red
            </button>
          )}
          {!ocupado && (
            <p className="ayuda">
              Se descargan en este dispositivo los mapas de {dias} {dias === 1 ? "día" : "días"} (≈{mb} MB). Solo se hace cuando lo pides.
            </p>
          )}
          {ocupado && (
            <p role="status" className="ayuda">
              {estado.tipo === "calculando" ? "Calculando…" : `Guardando día ${estado.dia} de ${estado.total}…`}
            </p>
          )}
          {ocupado && (
            <button type="button" className="boton" onClick={() => cancelar.current?.abort()}>
              Cancelar
            </button>
          )}
          {estado.tipo === "fin" && !estado.fallo && estado.guardados === 0 && (
            <p role="status" className="ayuda">
              No se ha podido guardar ningún mapa. Inténtalo de nuevo.
            </p>
          )}
          {estado.tipo === "fin" && estado.fallo && (
            <p role="status" className="ayuda">
              {TEXTO_FALLO[estado.fallo]}
            </p>
          )}
        </>
      )}
    </div>
  );
}
