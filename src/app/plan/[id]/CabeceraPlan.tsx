"use client";

import { useEffect, useRef, useState } from "react";
import { formatearEuros } from "@/lib/formato/numeros";
import { formatearFechaCorta } from "@/lib/etapas/ruta";
import { AvisoCiudad } from "./AvisoCiudad";
import { BotonInfografia } from "./BotonInfografia";
import { ComoLeerPlan } from "./ComoLeerPlan";
import type { PlanPublico } from "./tiposVista";

const TEXTO_CONFIRMACION_REGENERAR =
  "El plan actual se sustituirá por uno nuevo generado desde cero. Las paradas marcadas como visitadas se perderán. Tarda unos minutos y consume una generación de tu suscripción. ¿Seguir?";
const AYUDA_REGENERAR = "Vuelve a generar el plan con las mejoras actuales (alternativas, lugares comprobados, fotos)";
const ERROR_REGENERAR_GENERICO = "No se ha podido regenerar el viaje. Vuelve a intentarlo en un momento.";
const AVISO_FIJO = "Esta herramienta no es una fuente de navegación ni de seguridad.";

// «14 oct – 20 oct · 7 días · 3 ciudades · ≈ 1.240 € (2 personas)»
export function lineaResumen(plan: PlanPublico): string {
  const partes: string[] = [];
  const primera = plan.dias[0]?.fecha;
  const ultima = plan.dias[plan.dias.length - 1]?.fecha;
  if (primera && ultima) partes.push(primera === ultima ? formatearFechaCorta(primera) : `${formatearFechaCorta(primera)} – ${formatearFechaCorta(ultima)}`);
  partes.push(`${plan.dias.length} ${plan.dias.length === 1 ? "día" : "días"}`);
  if (plan.etapas && plan.etapas.length > 1) partes.push(`${plan.etapas.length} ciudades`);
  if (plan.presupuesto && plan.presupuesto.total_eur > 0) {
    const personas = plan.personas ?? 1;
    partes.push(`≈ ${formatearEuros(plan.presupuesto.total_eur)} (${personas} ${personas === 1 ? "persona" : "personas"})`);
  }
  return partes.join(" · ");
}

interface Props {
  plan: PlanPublico;
  planId: string;
  onRegenerado: (trabajoId: string) => void;
  onCiudadGuardada: () => void;
}

// vista-por-dias: lo que no se usa a cada rato (calendario, infografía,
// regenerar) vive en un menú; el botón destructivo va aparte y en rojo.
export function CabeceraPlan({ plan, planId, onRegenerado, onCiudadGuardada }: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  const [errorRegenerar, setErrorRegenerar] = useState<string | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (dialogoAbierto && !el.open) el.showModal();
    if (!dialogoAbierto && el.open) el.close();
  }, [dialogoAbierto]);

  // reg-ac1: "Cancelar" no toca `trabajos` -el POST solo sale del botón "Sí,
  // regenerar"-; reg-ac3 pone en `errorRegenerar` el mensaje exacto que
  // devuelve el servidor (409 ya en curso, 429 demasiado pronto).
  async function confirmarRegenerar() {
    setRegenerando(true);
    setErrorRegenerar(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/regenerar`, { method: "POST" });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setErrorRegenerar(typeof datos?.error === "string" ? datos.error : ERROR_REGENERAR_GENERICO);
        return;
      }
      onRegenerado(datos.trabajo_id);
    } catch {
      setErrorRegenerar(ERROR_REGENERAR_GENERICO);
    } finally {
      setRegenerando(false);
    }
  }

  return (
    <header className="cabecera-plan pila">
      <div className="fila">
        <h1>{plan.destino}</h1>
        <button type="button" className="boton" aria-expanded={menuAbierto} aria-controls="menu-opciones" onClick={() => setMenuAbierto(!menuAbierto)}>
          Opciones del viaje
        </button>
      </div>
      <p className="resumen-plan" data-testid="resumen-plan">
        {lineaResumen(plan)}
      </p>
      <p role="note" className="ayuda">
        {AVISO_FIJO}
      </p>

      {/* Siempre montado y solo oculto: BotonInfografia pide su previsualización al montarse. */}
      <div id="menu-opciones" className="menu-opciones pila" hidden={!menuAbierto}>
        {/* ics-ac2: enlace de descarga directo, sin JS -- `download` basta
            porque la petición es same-origin y lleva la cookie de sesión. */}
        <a className="boton" href={`/api/plan/${planId}/calendario.ics`} download aria-describedby="ayuda-calendario">
          Añadir al calendario
        </a>
        <p id="ayuda-calendario" className="ayuda">
          Descarga un fichero .ics que puedes abrir en Google Calendar o en el calendario del móvil
        </p>
        <BotonInfografia planId={planId} version={plan.version} />
        <hr />
        {/* usabilidad-ac8: nada de `title` -sin hover en táctil-; la ayuda va
            en un elemento visible al que aria-describedby apunta. */}
        <button type="button" className="boton-peligro" aria-describedby="ayuda-regenerar" onClick={() => setDialogoAbierto(true)}>
          Regenerar el viaje…
        </button>
        <p id="ayuda-regenerar" className="ayuda">
          {AYUDA_REGENERAR}
        </p>
      </div>

      <dialog ref={dialogo} aria-label="Regenerar este viaje" className="dialogo-regenerar" onClose={() => setDialogoAbierto(false)}>
        <p>{TEXTO_CONFIRMACION_REGENERAR}</p>
        <div className="fila">
          <button type="button" autoFocus onClick={() => setDialogoAbierto(false)} disabled={regenerando}>
            Cancelar
          </button>
          <button type="button" className="boton-peligro" onClick={() => void confirmarRegenerar()} disabled={regenerando}>
            {regenerando ? "Regenerando…" : "Sí, regenerar"}
          </button>
        </div>
        {errorRegenerar && <p role="alert">{errorRegenerar}</p>}
      </dialog>

      {/* reg-ac4: aviso visible en la versión anterior, todavía la que ve el
          usuario, mientras el trabajo sigue en vuelo. */}
      {plan.regenerando && (
        <div className="aviso">
          <p>
            Este viaje se está regenerando; el plan que ves se sustituirá cuando termine.{" "}
            <a href={`/trabajos/${plan.trabajoId}`}>Ver el progreso</a>
          </p>
        </div>
      )}

      {/* man-ac1: el contador se muestra siempre que hay plan, resuelto o no. */}
      <AvisoCiudad
        planId={planId}
        ciudad={plan.ciudad}
        totalParadas={plan.dias.reduce((total, dia) => total + dia.paradas.length, 0)}
        paradasUbicadas={plan.dias.reduce((total, dia) => total + dia.paradas.filter((parada) => !!parada.coordenadas).length, 0)}
        onGuardada={onCiudadGuardada}
      />

      {plan.avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}

      <ComoLeerPlan />
    </header>
  );
}
