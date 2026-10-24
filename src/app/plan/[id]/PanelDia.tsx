"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { aplicarOrden, ordenDeParadas, puedeMoverParada, type EntradaOrden } from "@/lib/plan/reordenar";
import { MAX_UBICADAS_OPTIMIZAR, MEJORA_MINIMA_KM, MIN_UBICADAS_OPTIMIZAR, optimizarOrdenDia, ubicadasDelDia } from "@/lib/plan/optimizarOrden";
import { formatearFechaDia } from "@/lib/plan/dias";
import { ERRORES_VACIOS, fijarError, leerError, limpiarError, type ErroresParada } from "@/lib/plan/erroresParada";
import { TEXTOS_CONFLICTOS } from "@/lib/textos/conflictos";
import { horariosForzados, instalarGanchosUat, suscribirHorariosForzados, type HorarioForzado } from "@/lib/testing/ganchosUat";
import { diaParaConflictos } from "./conflictosVista";
import { TEXTOS_AHORA } from "@/lib/textos/ahora";
import { urlRecorridoDia } from "@/lib/plan/urlRecorridoDia";
import { formatearKm } from "@/lib/formato/numeros";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { Evento } from "@/lib/eventos/tipos";
import { EventosDia } from "./SeccionEventos";
import { AnadirSitio } from "./AnadirSitio";
import { useSitiosPropios } from "./useSitiosPropios";
import { IconoFranja } from "./iconosFranja";
import { calcularComoLlegar, progresoDelDia, puntosDelDia, siguienteSinVisitar, tramoHastaSiguiente } from "./ahora";
import { claveNavegador } from "@/lib/google/claveNavegador";
import { TarjetaAhora } from "./TarjetaAhora";
import { TarjetaParada } from "./TarjetaParada";
import { ProveedorArrastre, reducirMovimiento } from "./arrastre";
import type { DiaPublico } from "./tiposVista";

// map-ac1: carga dinámica sin SSR -maplibre-gl exige `window` y no se
// puede renderizar en el servidor (guía SSR de @vis.gl/react-maplibre).
const MapaDia = dynamic(() => import("./MapaDia").then((m) => m.MapaDia), { ssr: false });

const SIN_FORZADOS: Readonly<Record<string, HorarioForzado>> = {};

const ERROR_CAMBIO_GENERICO = "No se ha podido cambiar la parada. El plan sigue como estaba; vuelve a intentarlo.";

// vista-por-dias: solo se monta el panel del día elegido, así que hay a lo
// sumo un mapa. map-ac1..ac5: un día entero (cabecera, mapa y lista de franjas/paradas)
// vive en su propio componente para que el estado de "qué marcador está
// activo" y las referencias a las tarjetas sean propios de ESTE día, sin
// mezclarse con los de otro día del mismo plan.
export function PanelDia({ dia: diaDelServidor, indice, etapa, destino, eventos, planId, version, hoy, zona, onPlanActualizado, onIrAResumen, ordenPendiente, onMover, onOptimizar, onReordenar, puedeAnadirSitios = false, soloLectura = false }: { dia: DiaPublico; destino: string; indice: number; eventos: Evento[]; etapa?: { ciudad: string; caja?: CajaDelimitadora }; planId: string; version: number; hoy: string; zona?: string; onPlanActualizado: () => void; onIrAResumen: () => void; ordenPendiente?: EntradaOrden[]; onMover?: (id: string, direccion: "arriba" | "abajo") => void; onOptimizar?: (orden: EntradaOrden[] | null, aviso: string) => void; onReordenar?: (orden: EntradaOrden[]) => void; puedeAnadirSitios?: boolean; soloLectura?: boolean }) {
  // El orden de la pantalla se adelanta al del servidor mientras se guarda;
  // la copia del servidor se conserva para atar lo provisional a ella.
  const diaServidor = diaDelServidor;
  // Los sitios propios se enseñan al momento y el servidor los confirma después.
  const sitios = useSitiosPropios(planId, version, indice, diaServidor, onPlanActualizado);
  const conSitios: DiaPublico = {
    ...diaServidor,
    paradas: diaServidor.paradas
      .filter((p) => !sitios.quitados.has(p.id))
      .map((p) => {
        const corregido = sitios.corregidos[p.id];
        if (corregido === undefined) return p;
        // Corregido el nombre, lo que se había resuelto ya no vale: igual que en el servidor.
        const { motivoSitio: _motivo, foto: _foto, coordenadas: _coordenadas, ...resto } = p;
        return { ...resto, nombre: corregido, estadoSitio: "buscando" as const };
      }),
  };
  const dia = ordenPendiente ? { ...conSitios, paradas: aplicarOrden(conSitios.paradas, ordenPendiente) } : conSitios;
  // Las tarjetas provisionales van al final y fuera de todo lo que reordena:
  // el servidor aún no sabe de ellas.
  const paradasVista = [...dia.paradas, ...sitios.anadidos];
  const recalculando = ordenPendiente !== undefined;
  const conControles = onMover !== undefined && dia.paradas.length >= 2;
  const conArrastre = conControles && onReordenar !== undefined;
  const tieneAlgunaParada = paradasVista.length > 0;
  const ubicadas = ubicadasDelDia(dia.paradas);
  const ayudaOptimizar =
    ubicadas < MIN_UBICADAS_OPTIMIZAR
      ? `Para optimizar hacen falta al menos ${MIN_UBICADAS_OPTIMIZAR} sitios ubicados en el día`
      : ubicadas > MAX_UBICADAS_OPTIMIZAR
        ? `Optimizar admite hasta ${MAX_UBICADAS_OPTIMIZAR} sitios ubicados por día`
        : null;
  const puntos = puntosDelDia(dia);

  // apertura-conflictos: opening_hours pesa y solo hace falta aquí, así que va
  // en su propio chunk y los conflictos aparecen cuando llega.
  const forzados = useSyncExternalStore(suscribirHorariosForzados, horariosForzados, () => SIN_FORZADOS);
  const [modConflictos, setModConflictos] = useState<typeof import("@/lib/plan/conflictos") | null>(null);
  useEffect(() => {
    instalarGanchosUat();
    let vivo = true;
    void import("@/lib/plan/conflictos").then((m) => vivo && setModConflictos(m));
    return () => {
      vivo = false;
    };
  }, []);
  const paraConflictos = diaParaConflictos(dia, forzados);
  // Con un orden pendiente las horas guardadas ya no valen: se espera al plan nuevo.
  const evaluacion = modConflictos && !ordenPendiente ? modConflictos.evaluarDia(paraConflictos.dia, { opciones: { perfil: null }, horarios: paraConflictos.horarios }) : null;
  const conflictoDe = new Map((evaluacion?.conflictos ?? []).map((c) => [c.paradaId, c]));
  const sinConfirmar = new Set(evaluacion?.sinConfirmar ?? []);
  const nConflictos = conflictoDe.size;

  // optimizar-orden: se calcula aquí, en el navegador y sobre el orden que se ve;
  // el hook solo guarda. Una mejora de menos de 0,1 km no merece una versión.
  function optimizar() {
    if (!onOptimizar) return;
    const ancla = diaServidor.ancla_alojamiento?.tipo === "zona-propuesta" ? diaServidor.ancla_alojamiento.centroide : null;
    // Un orden más corto no puede dejar cerrado un sitio que hoy no lo está.
    const comprobar = modConflictos
      ? (orden: readonly EntradaOrden[]) => {
          const porId = new Map(paraConflictos.dia.paradas.map((p) => [p.id, p]));
          const reordenado = aplicarOrden(paraConflictos.dia.paradas, [...orden]).filter((p) => porId.has(p.id));
          return modConflictos.evaluarDia({ ...paraConflictos.dia, paradas: reordenado }, { opciones: { perfil: null } }).conflictos.map((c) => c.paradaId);
        }
      : undefined;
    const resultado = optimizarOrdenDia(dia.paradas, dia.franjas, ancla, comprobar);
    if (resultado.dejaCerrado?.length) {
      const nombre = dia.paradas.find((p) => p.id === resultado.dejaCerrado![0])?.nombre ?? "";
      onOptimizar(null, TEXTOS_CONFLICTOS.ordenDejariaCerrado.texto.replace("{parada}", nombre));
      return;
    }
    const mejora = resultado.kmAntes - resultado.kmDespues;
    if (!resultado.mejora || mejora < MEJORA_MINIMA_KM) onOptimizar(null, "");
    else onOptimizar(resultado.orden, `Recorrido más corto: ${formatearKm(mejora)} menos (estimación en línea recta)`);
  }
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null);
  const [solicitudAlternativas, setSolicitudAlternativas] = useState<{ paradaId: string; veces: number } | null>(null);
  const [solicitudGoogle, setSolicitudGoogle] = useState<{ paradaId: string; veces: number } | null>(null);
  const [paradaConVisitaEnCurso, setParadaConVisitaEnCurso] = useState<string | null>(null);
  const refsTarjetas = useRef(new Map<string, HTMLLIElement>());
  const [cambiando, setCambiando] = useState<{ paradaId: string; alternativaId: string } | null>(null);
  // Un error por parada: cada tarjeta pinta solo el suyo.
  const [errores, setErrores] = useState<ErroresParada>(ERRORES_VACIOS);
  // El nombre nuevo se pinta en cuanto el servidor confirma la sustitución,
  // sin esperar a releer el plan entero (varios segundos). Está atado al `dia`
  // sobre el que se hizo: cuando llega el plan nuevo la referencia cambia y
  // el nombre provisional deja de aplicarse solo.
  const [provisional, setProvisional] = useState<{ dia: DiaPublico; nombres: Record<string, string> } | null>(null);
  const nombresProvisionales = provisional?.dia === diaServidor ? provisional.nombres : null;
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
      setProvisional((previo) => ({ dia: diaServidor, nombres: { ...(previo?.dia === diaServidor ? previo.nombres : {}), [paradaId]: nombreAlternativa } }));
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

  // dif-ac2: el atajo de «Ahora» abre el panel de Google de la siguiente parada
  // y lleva el foco a su tarjeta, igual que el aviso de paseo con alternativas.
  function abrirGoogleDesdeAhora(paradaId: string) {
    setSolicitudGoogle((previa) => ({ paradaId, veces: previa?.paradaId === paradaId ? previa.veces + 1 : 1 }));
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

  const ordenActual = ordenDeParadas(dia.paradas);

  const franjasDelDia = (conAsa: boolean) =>
    dia.franjas.map((franja) => {
          const paradasDeLaFranja = paradasVista.filter((parada) => parada.franja_id === franja.id);
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
                    planId={planId}
                    parada={nombresProvisionales?.[parada.id] ? { ...parada, nombre: nombresProvisionales[parada.id] } : parada}
                    franjaId={franja.id}
                    ciudad={etapa?.ciudad ?? destino}
                    tramo={tramoHasta.get(parada.id)}
                    tarjetaRef={(elemento) => {
                      if (elemento) refsTarjetas.current.set(parada.id, elemento);
                      else refsTarjetas.current.delete(parada.id);
                    }}
                    activa={parada.id === paradaActivaId}
                    solicitudAlternativas={solicitudAlternativas?.paradaId === parada.id ? solicitudAlternativas.veces : 0}
                    solicitudGoogle={solicitudGoogle?.paradaId === parada.id ? solicitudGoogle.veces : 0}
                    hoy={hoy}
                    conflicto={conflictoDe.get(parada.id)}
                    sinConfirmar={sinConfirmar.has(parada.id)}
                    esHoy={esHoy}
                    soloLectura={soloLectura}
                    esSiguiente={siguienteParada?.id === parada.id}
                    hrefComoLlegar={hrefComoLlegar ?? undefined}
                    visitaEnCurso={paradaConVisitaEnCurso === parada.id}
                    cambiando={cambiando}
                    error={leerError(errores, parada.id)}
                    onUsarAlternativa={(alternativaId, nombre) => usarAlternativa(parada.id, alternativaId, nombre)}
                    onAlternarVisita={(visitadaActualmente) => alternarVisita(parada.id, visitadaActualmente)}
                    sitio={!soloLectura && parada.propia && !sitios.anadidos.includes(parada) ? { onCorregir: (nombre) => sitios.corregir(parada.id, nombre), onQuitar: () => sitios.quitar(parada.id) } : undefined}
                    arrastre={conAsa && conControles && !sitios.anadidos.includes(parada) ? { indice: paradasDeLaFranja.indexOf(parada), reducirMovimiento: reducirMovimiento() } : undefined}
                    orden={
                      conControles && !sitios.anadidos.includes(parada)
                        ? {
                            numero: dia.paradas.indexOf(parada) + 1,
                            esPrimera: !puedeMoverParada(ordenActual, parada.id, "arriba"),
                            esUltima: !puedeMoverParada(ordenActual, parada.id, "abajo"),
                            onMover: (direccion) => onMover(parada.id, direccion),
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            </div>
          );
        });

  const seccionMapa =
    (tieneAlgunaParada || etapa?.caja) &&
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
      ));

  return (
    <section aria-labelledby="titulo-panel" className="seccion-dia" id={`dia-${indice}`}>
      {/* El foco pasa aquí al cambiar de día (VistaPlan); etv-ac2: en un
          viaje de varias ciudades el encabezado nombra la ciudad de la etapa. */}
      <h2 id="titulo-panel" tabIndex={-1}>
        Día {indice + 1} · {formatearFechaDia(dia.fecha)}
        {etapa ? ` · ${etapa.ciudad}` : ""}
      </h2>
      {nConflictos > 0 && (
        <p className="contador-conflictos" data-testid="contador-conflictos">
          {nConflictos === 1 ? TEXTOS_CONFLICTOS.contadorUno.texto : TEXTOS_CONFLICTOS.contadorVarios.texto.replace("{n}", String(nConflictos))}
        </p>
      )}
      {conControles && (
        <p className="ayuda ayuda-orden" id="ayuda-orden">
          Cambia el orden con ↑ ↓. Se guarda solo y puedes deshacerlo.
        </p>
      )}
      {onOptimizar && dia.paradas.length >= 2 && (
        <div className="optimizar-orden">
          <button type="button" className="boton" disabled={ayudaOptimizar !== null} aria-describedby={ayudaOptimizar ? "ayuda-optimizar" : undefined} onClick={optimizar}>
            Optimizar orden
          </button>
          {ayudaOptimizar && (
            <p className="ayuda" id="ayuda-optimizar">
              {ayudaOptimizar}
            </p>
          )}
        </div>
      )}
      {/* hoy-ac1: solo el día de hoy, y lo primero del panel. */}
      {esHoy && !soloLectura && (
        <TarjetaAhora
          siguiente={dia.paradas.find((p) => p.id === siguienteParada?.id) ?? null}
          hayUbicadas={puntos.length > 0}
          progreso={progresoDelDia(dia)}
          hrefComoLlegar={hrefComoLlegar}
          puedeComprobarEnGoogle={siguienteParada !== null && claveNavegador() !== null && dia.paradas.find((p) => p.id === siguienteParada.id)?.google?.estado === "casado"}
          tramo={tramoHastaSiguiente(dia.tramos ?? [], siguienteParada)}
          zona={zona}
          marcando={siguienteParada !== null && paradaConVisitaEnCurso === siguienteParada.id}
          errorVisita={siguienteParada ? leerError(errores, siguienteParada.id)?.mensaje : undefined}
          onMarcar={() => siguienteParada && alternarVisita(siguienteParada.id, false)}
          onComprobarEnGoogle={() => siguienteParada && abrirGoogleDesdeAhora(siguienteParada.id)}
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
              {dia.paseo.aviso.texto}.
              {!soloLectura && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="enlace-boton"
                    onClick={() => abrirPanelDesdeAviso(dia.paseo!.aviso!.paradaId)}
                  >
                    Ver sus alternativas
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}
      {!tieneAlgunaParada && <p className="dia-sin-paradas">Todavía no hay paradas planificadas para este día.</p>}

      {!soloLectura && seccionMapa}

      {recalculando && (
        <p role="status" className="ayuda recalculando">
          Recalculando…
        </p>
      )}
      <div className={recalculando ? "tramo-dia tramo-dia-recalculando" : "tramo-dia"} aria-busy={recalculando ? "true" : undefined}>
        <ProveedorArrastre
          activo={conArrastre}
          orden={ordenDeParadas(dia.paradas)}
          franjas={dia.franjas}
          nombres={Object.fromEntries(dia.paradas.map((p) => [p.id, nombresProvisionales?.[p.id] ?? p.nombre]))}
          onReordenar={(nuevo) => onReordenar?.(nuevo)}
        >
          {franjasDelDia}
        </ProveedorArrastre>
      </div>
      {/* sitio-propio: el aviso y el error van junto al botón, a la vista de quien acaba de pulsar. */}
      {sitios.error && (
        <p role="alert" className="mensaje-error" data-testid="error-sitio">
          {sitios.error}
        </p>
      )}
      {sitios.aviso && (
        <p role="status" className="aviso-sitio" data-testid="aviso-sitio">
          {sitios.aviso.texto}
          {sitios.aviso.idExterno && (
            <>
              {" · "}
              <button type="button" className="enlace-boton" onClick={sitios.deshacer}>
                Deshacer
              </button>
            </>
          )}
        </p>
      )}
      {puedeAnadirSitios && <AnadirSitio onAnadir={sitios.anadir} />}
      {/* inv-ac1: el invitado llega a ver la primera parada sin desplazarse; el mapa va tras el itinerario. */}
      {soloLectura && seccionMapa}
    </section>
  );
}
