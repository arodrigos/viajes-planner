"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { formatearFechaDia } from "@/lib/plan/dias";
import { ERRORES_VACIOS, fijarError, leerError, limpiarError, type ErroresParada } from "@/lib/plan/erroresParada";
import { TEXTOS_AHORA } from "@/lib/textos/ahora";
import { urlRecorridoDia } from "@/lib/plan/urlRecorridoDia";
import { formatearKm } from "@/lib/formato/numeros";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { Evento } from "@/lib/eventos/tipos";
import { EventosDia } from "./SeccionEventos";
import { IconoFranja } from "./iconosFranja";
import { calcularComoLlegar, progresoDelDia, puntosDelDia, siguienteSinVisitar, tramoHastaSiguiente } from "./ahora";
import { TarjetaAhora } from "./TarjetaAhora";
import { TarjetaParada } from "./TarjetaParada";
import type { DiaPublico } from "./tiposVista";

// map-ac1: carga dinámica sin SSR -maplibre-gl exige `window` y no se
// puede renderizar en el servidor (guía SSR de @vis.gl/react-maplibre).
const MapaDia = dynamic(() => import("./MapaDia").then((m) => m.MapaDia), { ssr: false });

const ERROR_CAMBIO_GENERICO = "No se ha podido cambiar la parada. El plan sigue como estaba; vuelve a intentarlo.";

// vista-por-dias: solo se monta el panel del día elegido, así que hay a lo
// sumo un mapa. map-ac1..ac5: un día entero (cabecera, mapa y lista de franjas/paradas)
// vive en su propio componente para que el estado de "qué marcador está
// activo" y las referencias a las tarjetas sean propios de ESTE día, sin
// mezclarse con los de otro día del mismo plan.
export function PanelDia({ dia, indice, etapa, destino, eventos, planId, hoy, zona, onPlanActualizado, onIrAResumen }: { dia: DiaPublico; destino: string; indice: number; eventos: Evento[]; etapa?: { ciudad: string; caja?: CajaDelimitadora }; planId: string; hoy: string; zona?: string; onPlanActualizado: () => void; onIrAResumen: () => void }) {
  const tieneAlgunaParada = dia.paradas.length > 0;
  const puntos = puntosDelDia(dia);
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null);
  const [solicitudAlternativas, setSolicitudAlternativas] = useState<{ paradaId: string; veces: number } | null>(null);
  const [paradaConVisitaEnCurso, setParadaConVisitaEnCurso] = useState<string | null>(null);
  const refsTarjetas = useRef(new Map<string, HTMLLIElement>());
  const [cambiando, setCambiando] = useState<{ paradaId: string; alternativaId: string } | null>(null);
  // Un error por parada: cada tarjeta pinta solo el suyo.
  const [errores, setErrores] = useState<ErroresParada>(ERRORES_VACIOS);
  const [avisoCambio, setAvisoCambio] = useState<string | null>(null);
  const [mapaAmpliado, setMapaAmpliado] = useState(false);

  // dest-ac2/dest-ac3: "hoy" llega ya calculado en la zona del destino -- solo
  // el día de hoy muestra botones de visita, mapa centrado en la siguiente
  // parada y "Cómo llegar".
  const esHoy = dia.fecha === hoy;
  const idsVisitados = new Set(dia.paradas.filter((p) => p.visitada).map((p) => p.id));
  const siguienteParada = esHoy ? siguienteSinVisitar(puntos, idsVisitados) : null;
  const hrefComoLlegar = esHoy ? calcularComoLlegar(puntos, siguienteParada, idsVisitados) : null;

  // alr-ac2/alr-ac3: `cambiando` es a la vez el estado visible y el cerrojo
  // contra la doble pulsación; un ref evita que dos clics en el mismo tick
  // lancen dos POST antes de que React repinte el botón deshabilitado.
  const cambiandoRef = useRef(false);
  async function usarAlternativa(paradaId: string, alternativaId: string, nombreAlternativa: string): Promise<boolean> {
    if (cambiandoRef.current) return false;
    cambiandoRef.current = true;
    setCambiando({ paradaId, alternativaId });
    setErrores((e) => limpiarError(e, paradaId));
    setAvisoCambio(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/paradas/${paradaId}/sustituir`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alternativa_id: alternativaId }),
      });
      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        // El mensaje viene del servidor ya curado; si no es una cadena razonable, el genérico.
        const mensaje = typeof datos?.error === "string" && datos.error.length <= 200 ? datos.error : ERROR_CAMBIO_GENERICO;
        setErrores((e) => fijarError(e, paradaId, { tipo: "cambio", mensaje }));
        return false;
      }
      setAvisoCambio(`Hecho: ahora vas a ${nombreAlternativa}. Para deshacerlo, abre sus alternativas.`);
      onPlanActualizado();
      // El <li> de la parada sobrevive a la recarga (su id externo no cambia),
      // así que el foco no se pierde cuando llegue la versión nueva.
      refsTarjetas.current.get(paradaId)?.focus();
      return true;
    } catch {
      setErrores((e) => fijarError(e, paradaId, { tipo: "cambio", mensaje: ERROR_CAMBIO_GENERICO }));
      return false;
    } finally {
      cambiandoRef.current = false;
      setCambiando(null);
    }
  }

  // dest-ac1: marcar/desmarcar es siempre el mismo cuerpo `{ parada_id }` --
  // `parada_id` es el id EXTERNO (sobrevive a una sustitución), igual que
  // `paradaId` en usarAlternativa.
  async function alternarVisita(paradaId: string, visitadaActualmente: boolean) {
    setParadaConVisitaEnCurso(paradaId);
    setErrores((e) => limpiarError(e, paradaId));
    try {
      const respuesta = await fetch(`/api/plan/${planId}/visitas`, {
        method: visitadaActualmente ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parada_id: paradaId }),
      });
      if (respuesta.ok) onPlanActualizado();
      else setErrores((e) => fijarError(e, paradaId, { tipo: "visita", mensaje: TEXTOS_AHORA.errorVisita.texto }));
    } catch {
      setErrores((e) => fijarError(e, paradaId, { tipo: "visita", mensaje: TEXTOS_AHORA.errorVisita.texto }));
    } finally {
      setParadaConVisitaEnCurso(null);
    }
  }

  function seleccionarParada(paradaId: string) {
    setParadaActivaId(paradaId);
    refsTarjetas.current.get(paradaId)?.scrollIntoView({ block: "nearest" });
  }

  // enc-ac2: el aviso de "mucho paseo" enlaza al panel de alternativas de
  // la parada más alejada -- abrirlo y llevar la vista hasta su tarjeta,
  // igual que hace tocar su marcador en el mapa.
  function abrirPanelDesdeAviso(paradaId: string) {
    setSolicitudAlternativas((previa) => ({ paradaId, veces: previa?.paradaId === paradaId ? previa.veces + 1 : 1 }));
    seleccionarParada(paradaId);
    refsTarjetas.current.get(paradaId)?.focus();
  }

  const tramosDelDia = dia.tramos ?? [];
  // Región viva fuera del panel: el panel se cierra al terminar y el aviso
  // de «Hecho» tiene que seguir anunciándose.

  const tramoHasta = new Map(tramosDelDia.map((t) => [t.hastaId, t]));
  // Con algún tramo que no es a pie, forzar travelmode=walking en el
  // recorrido completo mandaría andar kilómetros de transporte.
  const todoAPie = tramosDelDia.every((t) => t.modo === "a-pie");
  const tramos = puntos.length > 0 ? urlRecorridoDia(puntos.map((p) => ({ lat: p.lat, lon: p.lon })), todoAPie) : [];

  return (
    <section aria-labelledby="titulo-panel" className="seccion-dia" id={`dia-${indice}`}>
      {/* El foco pasa aquí al cambiar de día (VistaPlan); etv-ac2: en un
          viaje de varias ciudades el encabezado nombra la ciudad de la etapa. */}
      <h2 id="titulo-panel" tabIndex={-1}>
        Día {indice + 1} · {formatearFechaDia(dia.fecha)}
        {etapa ? ` · ${etapa.ciudad}` : ""}
      </h2>
      {/* hoy-ac1: solo el día de hoy, y lo primero del panel. */}
      {esHoy && (
        <TarjetaAhora
          siguiente={dia.paradas.find((p) => p.id === siguienteParada?.id) ?? null}
          hayUbicadas={puntos.length > 0}
          progreso={progresoDelDia(dia)}
          hrefComoLlegar={hrefComoLlegar}
          tramo={tramoHastaSiguiente(dia.tramos ?? [], siguienteParada)}
          zona={zona}
          marcando={siguienteParada !== null && paradaConVisitaEnCurso === siguienteParada.id}
          errorVisita={siguienteParada ? leerError(errores, siguienteParada.id)?.mensaje : undefined}
          onMarcar={() => siguienteParada && alternarVisita(siguienteParada.id, false)}
          onIrARecomendados={onIrAResumen}
        />
      )}
      {avisoCambio && <p role="status" className="ayuda">{avisoCambio}</p>}
      <EventosDia eventos={eventos} />
      {/* enc-ac2: ausente cuando el día tiene menos de dos paradas
          resueltas -- nunca un paseo a medias. */}
      {dia.paseo && (
        <p className="paseo-dia">
          A pie: {formatearKm(dia.paseo.km)}
          {dia.paseo.kmTransporte !== undefined && <> · En transporte: {formatearKm(dia.paseo.kmTransporte)}</>}
          {dia.paseo.aviso && (
            <>
              {" — "}
              {dia.paseo.aviso.texto}.{" "}
              <button
                type="button"
                className="enlace-boton"
                onClick={() => abrirPanelDesdeAviso(dia.paseo!.aviso!.paradaId)}
              >
                Ver sus alternativas
              </button>
            </>
          )}
        </p>
      )}
      {!tieneAlgunaParada && <p className="dia-sin-paradas">Todavía no hay paradas planificadas para este día.</p>}

      {(tieneAlgunaParada || etapa?.caja) &&
        (puntos.length === 0 && !etapa?.caja ? (
          // map-ac5: un día sin ninguna parada resuelta no tiene mapa, y se
          // explica por qué en vez de dejar un hueco mudo.
          <p className="mapa-sin-paradas">Sin mapa: ninguna parada de este día se ha podido ubicar todavía.</p>
        ) : (
          <div className="seccion-mapa-dia">
            <MapaDia
              alto={mapaAmpliado ? 420 : 200}
              puntos={puntos}
              paradaActivaId={paradaActivaId}
              onSeleccionarParada={seleccionarParada}
              idsVisitados={idsVisitados}
              centroParadaId={siguienteParada?.id ?? null}
              cajaEtapa={etapa?.caja}
            />
            <button type="button" className="boton" aria-expanded={mapaAmpliado} onClick={() => setMapaAmpliado(!mapaAmpliado)}>
              {mapaAmpliado ? "Reducir mapa" : "Ampliar mapa"}
            </button>
            <ul className="pila enlaces-recorrido">
              {tramos.map((tramo) => (
                <li key={tramo.href}>
                  <a href={tramo.href} target="_blank" rel="noopener noreferrer">
                    {tramo.etiqueta}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

      <div className="tramo-dia">
        {dia.franjas.map((franja) => {
          const paradasDeLaFranja = dia.paradas.filter((parada) => parada.franja_id === franja.id);
          if (paradasDeLaFranja.length === 0) return null;
          return (
            <div key={franja.id} className="seccion-franja">
              <div
                className="cabecera-franja"
                style={{
                  background: `var(--franja-${franja.id}-fondo, var(--superficie))`,
                  color: `var(--franja-${franja.id}-texto, var(--foreground))`,
                }}
              >
                <IconoFranja franjaId={franja.id} />
                {/* maq-ac2: la etiqueta va SIEMPRE en texto -el icono y
                    el color de fondo son un refuerzo visual, nunca el
                    único portador de la información. */}
                <h3>{franja.etiqueta}</h3>
              </div>
              <ul className="pila">
                {paradasDeLaFranja.map((parada) => (
                  <TarjetaParada
                    key={parada.id}
                    parada={parada}
                    franjaId={franja.id}
                    ciudad={etapa?.ciudad ?? destino}
                    tramo={tramoHasta.get(parada.id)}
                    tarjetaRef={(elemento) => {
                      if (elemento) refsTarjetas.current.set(parada.id, elemento);
                      else refsTarjetas.current.delete(parada.id);
                    }}
                    activa={parada.id === paradaActivaId}
                    solicitudAlternativas={solicitudAlternativas?.paradaId === parada.id ? solicitudAlternativas.veces : 0}
                    esHoy={esHoy}
                    esSiguiente={siguienteParada?.id === parada.id}
                    hrefComoLlegar={hrefComoLlegar ?? undefined}
                    visitaEnCurso={paradaConVisitaEnCurso === parada.id}
                    cambiando={cambiando}
                    error={leerError(errores, parada.id)}
                    onUsarAlternativa={(alternativaId, nombre) => usarAlternativa(parada.id, alternativaId, nombre)}
                    onAlternarVisita={(visitadaActualmente) => alternarVisita(parada.id, visitadaActualmente)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
