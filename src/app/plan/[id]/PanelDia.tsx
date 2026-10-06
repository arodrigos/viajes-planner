"use client";

import dynamic from "next/dynamic";
import { Fragment, useRef, useState } from "react";
import { formatearFechaDia } from "@/lib/plan/dias";
import { urlComoLlegar } from "@/lib/plan/urlComoLlegar";
import { urlRecorridoDia } from "@/lib/plan/urlRecorridoDia";
import { formatearKm } from "@/lib/formato/numeros";
import { textoPrecioParada } from "@/lib/presupuesto/texto";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { Evento } from "@/lib/eventos/tipos";
import { AccionesVisita } from "./AccionesVisita";
import { ConectorTramo } from "./ConectorTramo";
import { EnlacesParada } from "./EnlacesParada";
import { EventosDia } from "./SeccionEventos";
import { IconoFranja } from "./iconosFranja";
import { IconoSinFoto } from "./iconoSinFoto";
import type { PuntoMapaDia } from "./MapaDia";
import { SeccionesGuia } from "./SeccionesGuia";
import type { DiaPublico } from "./tiposVista";

// map-ac1: carga dinámica sin SSR -maplibre-gl exige `window` y no se
// puede renderizar en el servidor (guía SSR de @vis.gl/react-maplibre).
const MapaDia = dynamic(() => import("./MapaDia").then((m) => m.MapaDia), { ssr: false });

const ERROR_CAMBIO_GENERICO = "No se ha podido cambiar la parada. El plan sigue como estaba; vuelve a intentarlo.";

// map-ac1: numera en el orden real de las franjas del día (mañana antes
// que comida antes que tarde...), no en el orden en que llegaron del
// servidor; solo las paradas resueltas (con coordenadas) entran en el
// mapa y en el enlace de recorrido.
function puntosDelDia(dia: DiaPublico): PuntoMapaDia[] {
  const puntos: PuntoMapaDia[] = [];
  let orden = 0;
  for (const franja of dia.franjas) {
    for (const parada of dia.paradas.filter((p) => p.franja_id === franja.id)) {
      if (!parada.coordenadas) continue;
      orden += 1;
      puntos.push({ id: parada.id, orden, nombre: parada.nombre, lat: parada.coordenadas.lat, lon: parada.coordenadas.lon });
    }
  }
  return puntos;
}

// dest-ac2: la siguiente parada sin visitar, en el orden real de las
// franjas (el mismo de puntosDelDia) -- es donde se centra el mapa del día
// de hoy, haya o no enlace "Cómo llegar" todavía.
function siguienteSinVisitar(puntos: PuntoMapaDia[], idsVisitados: Set<string>): PuntoMapaDia | null {
  return puntos.find((p) => !idsVisitados.has(p.id)) ?? null;
}

// dest-ac2: "última visitada, o la primera" hasta la siguiente sin
// visitar. Si todas las paradas resueltas ya están visitadas, o si la
// "última visitada" coincide con la "siguiente" (nada visitado todavía y
// la primera parada es la siguiente), no hay enlace -aunque el mapa sí se
// siga centrando en esa parada, ver siguienteSinVisitar.
function calcularComoLlegar(puntos: PuntoMapaDia[], siguiente: PuntoMapaDia | null, idsVisitados: Set<string>): string | null {
  if (!siguiente) return null;

  let origen = puntos[0];
  for (const punto of puntos) {
    if (idsVisitados.has(punto.id)) origen = punto;
  }
  if (origen.id === siguiente.id) return null;

  return urlComoLlegar(origen, siguiente);
}


// vista-por-dias: solo se monta el panel del día elegido, así que hay a lo
// sumo un mapa. map-ac1..ac5: un día entero (cabecera, mapa y lista de franjas/paradas)
// vive en su propio componente para que el estado de "qué marcador está
// activo" y las referencias a las tarjetas sean propios de ESTE día, sin
// mezclarse con los de otro día del mismo plan.
export function PanelDia({ dia, indice, etapa, destino, eventos, planId, hoy, onPlanActualizado }: { dia: DiaPublico; destino: string; indice: number; eventos: Evento[]; etapa?: { ciudad: string; caja?: CajaDelimitadora }; planId: string; hoy: string; onPlanActualizado: () => void }) {
  const tieneAlgunaParada = dia.paradas.length > 0;
  const puntos = puntosDelDia(dia);
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null);
  const [paradaConPanelAbiertoId, setParadaConPanelAbiertoId] = useState<string | null>(null);
  const [paradaConVisitaEnCurso, setParadaConVisitaEnCurso] = useState<string | null>(null);
  const refsTarjetas = useRef(new Map<string, HTMLLIElement>());
  const [cambiando, setCambiando] = useState<{ paradaId: string; alternativaId: string } | null>(null);
  const [errorCambio, setErrorCambio] = useState<string | null>(null);
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
  async function usarAlternativa(paradaId: string, alternativaId: string, nombreAlternativa: string) {
    if (cambiandoRef.current) return;
    cambiandoRef.current = true;
    setCambiando({ paradaId, alternativaId });
    setErrorCambio(null);
    setAvisoCambio(null);
    try {
      const respuesta = await fetch(`/api/plan/${planId}/paradas/${paradaId}/sustituir`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alternativa_id: alternativaId }),
      });
      if (!respuesta.ok) {
        const datos = await respuesta.json().catch(() => null);
        setErrorCambio(typeof datos?.error === "string" ? datos.error : ERROR_CAMBIO_GENERICO);
        return;
      }
      setParadaConPanelAbiertoId(null);
      setAvisoCambio(`Hecho: ahora vas a ${nombreAlternativa}. Para deshacerlo, abre sus alternativas.`);
      onPlanActualizado();
      // El <li> de la parada sobrevive a la recarga (su id externo no cambia),
      // así que el foco no se pierde cuando llegue la versión nueva.
      refsTarjetas.current.get(paradaId)?.focus();
    } catch {
      setErrorCambio(ERROR_CAMBIO_GENERICO);
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
    try {
      const respuesta = await fetch(`/api/plan/${planId}/visitas`, {
        method: visitadaActualmente ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parada_id: paradaId }),
      });
      if (respuesta.ok) onPlanActualizado();
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
    setParadaConPanelAbiertoId(paradaId);
    seleccionarParada(paradaId);
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
                  <Fragment key={parada.id}>
                  {tramoHasta.get(parada.id) && <ConectorTramo tramo={tramoHasta.get(parada.id)!} />}
                  <li
                    ref={(elemento) => {
                      if (elemento) refsTarjetas.current.set(parada.id, elemento);
                      else refsTarjetas.current.delete(parada.id);
                    }}
                    className="tarjeta-parada"
                    tabIndex={-1}
                    // map-ac2: tocar el marcador correspondiente en el mapa
                    // marca esta tarjeta con aria-current (la anterior lo
                    // pierde) y la desplaza a la vista.
                    aria-current={parada.id === paradaActivaId ? "true" : undefined}
                  >
                    <IconoFranja franjaId={franja.id} />
                    <div>
                      <strong>{parada.nombre}</strong>
                      {parada.horario && (
                        <p className="horario-parada" data-testid="horario-parada">
                          <time>{parada.horario.inicio} – {parada.horario.fin}</time>
                          {" · "}
                          {parada.horario.apertura}
                          {parada.horario.aviso && <span className="aviso-horario"> · {parada.horario.aviso}</span>}
                        </p>
                      )}
                      <p>{parada.descripcion}</p>
                      {/* mot-ac1: el motivo va rotulado como del modelo -es
                          su opinión, no un dato comprobado-; sin motivo (plan
                          anterior) la sección no aparece, el precio sí dice
                          que no hay. */}
                      {parada.motivo && (
                        <div className="motivo-parada" data-testid="motivo-parada">
                          <p>
                            <strong>Por qué te lo proponemos</strong> <span className="etiqueta-modelo">Lo dice el planificador</span>
                          </p>
                          <p className="texto-motivo">{parada.motivo}</p>
                        </div>
                      )}
                      <p className="precio-parada" data-testid="precio-parada">
                        {textoPrecioParada(parada.coste)}
                      </p>
                      <SeccionesGuia nombre={parada.nombre} guia={parada.guia} curiosidades={parada.curiosidades} intentada={Boolean(parada.guia_intentada_en)} />
                      {/* fot-ac2/fot-ac3: la foto nunca viene de otro
                          sitio -procede de resolverFotos.ts, server-only-;
                          sin ella, el marcador de posición es digno, nunca
                          un hueco roto. */}
                      {parada.foto ? (
                        <>
                          <img src={parada.foto.url} alt={parada.nombre} loading="lazy" className="foto-parada" />
                          <p className="atribucion-foto">
                            Foto:{" "}
                            <a href={parada.foto.pagina_url} target="_blank" rel="noopener noreferrer">
                              {parada.foto.autor}
                            </a>{" "}
                            ·{" "}
                            <a href={parada.foto.licencia_url} target="_blank" rel="noopener noreferrer">
                              {parada.foto.licencia}
                            </a>
                          </p>
                        </>
                      ) : (
                        <div className="foto-ausente">
                          <IconoSinFoto />
                          <span>Sin foto</span>
                        </div>
                      )}
                      {parada.procedencia.fuente === "propuesto-sin-verificar" ? (
                        <p className="procedencia-parada">
                          Sin comprobar. No hemos podido localizar este sitio en los mapas abiertos: comprueba el
                          nombre y la dirección antes de ir.
                        </p>
                      ) : (
                        <p className="procedencia-parada">
                          Ubicación comprobada en {parada.procedencia.fuente === "osm" ? "OpenStreetMap" : "Wikipedia"}
                        </p>
                      )}
                      <EnlacesParada parada={parada} ciudad={etapa?.ciudad ?? destino} tramo={tramoHasta.get(parada.id)} />
                      {/* dest-ac1..ac3: solo el día de hoy -- un día pasado
                          o futuro no muestra ningún botón de visita. */}
                      {esHoy && (
                        <AccionesVisita
                          sesionActiva={true}
                          visitada={Boolean(parada.visitada)}
                          tieneUbicacion={Boolean(parada.coordenadas)}
                          cargando={paradaConVisitaEnCurso === parada.id}
                          hrefComoLlegar={siguienteParada?.id === parada.id ? (hrefComoLlegar ?? undefined) : undefined}
                          onMarcar={() => alternarVisita(parada.id, false)}
                          onDesmarcar={() => alternarVisita(parada.id, true)}
                        />
                      )}
                      {/* cam-ac1: el botón solo existe si hay a qué cambiar; un
                          botón que abre un panel vacío era ruido. */}
                      {(parada.alternativas ?? []).length > 0 && (
                        <button
                          type="button"
                          className="boton"
                          aria-expanded={paradaConPanelAbiertoId === parada.id}
                          onClick={() =>
                            setParadaConPanelAbiertoId(paradaConPanelAbiertoId === parada.id ? null : parada.id)
                          }
                        >
                          Cambiar por una alternativa
                        </button>
                      )}
                      {paradaConPanelAbiertoId === parada.id && (
                        <div
                          className="panel-alternativas"
                          role="region"
                          aria-label={`Alternativas a ${parada.nombre}`}
                          aria-busy={cambiando?.paradaId === parada.id ? "true" : undefined}
                        >
                          {cambiando?.paradaId === parada.id && <p role="status">Cambiando la parada…</p>}
                          {errorCambio && <p role="alert">{errorCambio}</p>}
                          <p className="ayuda-alternativas">
                            Cambiar una parada crea una nueva versión del plan; podrás volver a la anterior desde esta
                            misma lista.
                          </p>
                          {/* El panel también se abre desde «Ver sus alternativas» del paseo
                              del día, sin botón de cambio: el estado vacío sigue siendo alcanzable. */}
                          {(parada.alternativas ?? []).length === 0 ? (
                            <div className="alternativas-vacio">
                              <p>No hay alternativas comprobadas para esta parada.</p>
                              <p className="ayuda-alternativas">
                                Las alternativas salen al generar el plan; los viajes anteriores no las tienen. Puedes
                                regenerar este viaje desde el menú del plan para obtenerlas.
                              </p>
                            </div>
                          ) : (
                            <ul className="pila lista-alternativas">
                              {(parada.alternativas ?? []).map((alternativa, indice) => (
                                <li key={alternativa.id ?? `${parada.id}-${indice}`} className="tarjeta-alternativa">
                                  {alternativa.foto ? (
                                    <img src={alternativa.foto.url} alt={alternativa.nombre} loading="lazy" className="foto-alternativa" />
                                  ) : (
                                    <div className="foto-ausente">
                                      <IconoSinFoto />
                                      <span>Sin foto</span>
                                    </div>
                                  )}
                                  <div>
                                    <strong>{alternativa.nombre}</strong>
                                    <p>{alternativa.motivo}</p>
                                    <p className="metadatos-alternativa">
                                      {alternativa.distancia_m !== undefined && <span>A {alternativa.distancia_m} m</span>}{" "}
                                      <span>{alternativa.origen === "cercano" ? "cerca de aquí" : "propuesta"}</span>
                                    </p>
                                    {/* enc-ac1: hechos calculados, no redactados -- ver
                                        formatearEtiquetasEncaje en src/lib/alternativas/encaje.ts. */}
                                    {alternativa.etiquetasEncaje.length > 0 && (
                                      <ul className="pila etiquetas-encaje">
                                        {alternativa.etiquetasEncaje.map((etiqueta) => (
                                          <li key={etiqueta}>{etiqueta}</li>
                                        ))}
                                      </ul>
                                    )}
                                    <button
                                      type="button"
                                      className="boton boton-principal"
                                      disabled={!alternativa.id || cambiando !== null}
                                      onClick={() => alternativa.id && usarAlternativa(parada.id, alternativa.id, alternativa.nombre)}
                                    >
                                      {cambiando?.alternativaId === alternativa.id ? "Cambiando…" : "Usar esta"}
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                  </Fragment>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
