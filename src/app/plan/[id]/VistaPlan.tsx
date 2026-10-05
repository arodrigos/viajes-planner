"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { esFechaDeHoy } from "@/lib/plan/fechaHoy";
import { formatearKm } from "@/lib/plan/paseo";
import { urlBusquedaSitio } from "@/lib/plan/urlBusquedaSitio";
import { urlComoLlegar } from "@/lib/plan/urlComoLlegar";
import { urlRecorridoDia } from "@/lib/plan/urlRecorridoDia";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { AccionesVisita } from "./AccionesVisita";
import { AvisoCiudad } from "./AvisoCiudad";
import type { PuntoMapaDia } from "./MapaDia";
import { IconoFranja } from "./iconosFranja";
import { IconoRecomendacion } from "./iconosRecomendacion";
import { IconoSinFoto } from "./iconoSinFoto";

// map-ac1: carga dinámica sin SSR -maplibre-gl exige `window` y no se
// puede renderizar en el servidor (guía SSR de @vis.gl/react-maplibre).
const MapaDia = dynamic(() => import("./MapaDia").then((m) => m.MapaDia), { ssr: false });

interface FranjaPublica {
  id: string;
  etiqueta: string;
}

interface ProcedenciaPublica {
  fuente: "propuesto-sin-verificar" | "osm" | "wikipedia";
  url?: string;
}

interface FotoPublica {
  url: string;
  autor: string;
  licencia: string;
  licencia_url: string;
  pagina_url: string;
}

// bloque alternativas-equivalentes
interface AlternativaPublica {
  id?: string;
  nombre: string;
  descripcion: string;
  motivo: string;
  origen?: "modelo" | "cercano";
  distancia_m?: number;
  foto?: FotoPublica;
  coordenadas?: { lat: number; lon: number };
  procedencia: ProcedenciaPublica;
  // encaje-y-paseo (enc-ac1): ya formateadas por el servidor
  // (formatearEtiquetasEncaje) -- este componente solo las pinta.
  etiquetasEncaje: string[];
}

// encaje-y-paseo (enc-ac2)
interface AvisoPaseoPublico {
  texto: string;
  paradaId: string;
}

interface PaseoPublico {
  km: number;
  aviso?: AvisoPaseoPublico;
}

interface ParadaPublica {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  procedencia: ProcedenciaPublica;
  coordenadas?: { lat: number; lon: number };
  foto?: FotoPublica;
  alternativas?: AlternativaPublica[];
  // bloque uso-en-destino (dest-ac1/dest-ac4): ausente cuando no está
  // visitada, mismo patrón que el resto de este tipo.
  visitada?: boolean;
}

interface DiaPublico {
  fecha: string;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
  paseo?: PaseoPublico;
}

interface RecomendacionPublica {
  tipo: string;
  nombre: string;
  motivo: string;
}

interface PlanPublico {
  id: string;
  destino: string;
  dias: DiaPublico[];
  avisos: string[];
  recomendaciones: RecomendacionPublica[];
  // reg-ac4: el aviso de "se está regenerando" y su enlace al progreso
  // necesitan saber si hay una regeneración en vuelo y a qué trabajo
  // enlazar -- route.ts los añade por encima de aPlanPublico.
  regenerando: boolean;
  trabajoId: string;
  // ciudad-a-mano (man-ac1): ausente cuando el relleno todavía no la ha
  // intentado -- mismo patrón que el resto de campos opcionales de este
  // tipo (ver aPlanPublico en publico.ts).
  ciudad?: CiudadEfectiva;
}

const TEXTO_CONFIRMACION_REGENERAR =
  "El plan actual se sustituirá por uno nuevo generado desde cero. Las paradas marcadas como visitadas se perderán. Tarda unos minutos y consume una generación de tu suscripción. ¿Seguir?";
const AYUDA_REGENERAR = "Vuelve a generar el plan con las mejoras actuales (alternativas, lugares comprobados, fotos)";
const ERROR_REGENERAR_GENERICO = "No se ha podido regenerar el viaje. Vuelve a intentarlo en un momento.";

// lug-ac7: reescrito -ya no dice "ninguna parada"- porque desde este
// bloque una parada SÍ puede estar comprobada contra OpenStreetMap o
// Wikipedia; el aviso sigue fijo y sin control de cierre, pero ahora
// explica qué significa cada marca en vez de negarlas todas por igual.
const AVISO_FIJO =
  "Las paradas marcadas como comprobadas se han localizado en OpenStreetMap o Wikipedia; las demás no. Esta herramienta no es una fuente de navegación ni de seguridad.";

// reco-ac7(c): mismo criterio que AVISO_FIJO -fijo, sin control de cierre-,
// porque cada enlace de esta sección abre una búsqueda (urlBusquedaSitio.ts)
// y no una reserva ni un listado verificado; ocultarlo detrás de un botón
// sugeriría una garantía que la herramienta no da.
const AVISO_RECOMENDACIONES =
  "Cada enlace abre una búsqueda en un mapa, no una reserva ni un listado verificado.";

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

// map-ac1..ac5: un día entero (cabecera, mapa y lista de franjas/paradas)
// vive en su propio componente para que el estado de "qué marcador está
// activo" y las referencias a las tarjetas sean propios de ESTE día, sin
// mezclarse con los de otro día del mismo plan.
function SeccionDia({ dia, planId, onPlanActualizado }: { dia: DiaPublico; planId: string; onPlanActualizado: () => void }) {
  const tieneAlgunaParada = dia.paradas.length > 0;
  const puntos = puntosDelDia(dia);
  const [paradaActivaId, setParadaActivaId] = useState<string | null>(null);
  const [paradaConPanelAbiertoId, setParadaConPanelAbiertoId] = useState<string | null>(null);
  const [paradaConVisitaEnCurso, setParadaConVisitaEnCurso] = useState<string | null>(null);
  const refsTarjetas = useRef(new Map<string, HTMLLIElement>());

  // dest-ac2/dest-ac3: "hoy" es la fecha del dispositivo, nunca UTC -- solo
  // el día de hoy muestra botones de visita, mapa centrado en la siguiente
  // parada y "Cómo llegar".
  const esHoy = esFechaDeHoy(dia.fecha);
  const idsVisitados = new Set(dia.paradas.filter((p) => p.visitada).map((p) => p.id));
  const siguienteParada = esHoy ? siguienteSinVisitar(puntos, idsVisitados) : null;
  const hrefComoLlegar = esHoy ? calcularComoLlegar(puntos, siguienteParada, idsVisitados) : null;

  async function usarAlternativa(paradaId: string, alternativaId: string) {
    const respuesta = await fetch(`/api/plan/${planId}/paradas/${paradaId}/sustituir`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alternativa_id: alternativaId }),
    });
    if (respuesta.ok) {
      setParadaConPanelAbiertoId(null);
      onPlanActualizado();
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

  const tramos = puntos.length > 0 ? urlRecorridoDia(puntos.map((p) => ({ lat: p.lat, lon: p.lon }))) : [];

  return (
    <section aria-label={`Día ${dia.fecha}`} className="seccion-dia">
      <h2>{dia.fecha}</h2>
      {/* enc-ac2: ausente cuando el día tiene menos de dos paradas
          resueltas -- nunca un paseo a medias. */}
      {dia.paseo && (
        <p className="paseo-dia">
          Paseo estimado: {formatearKm(dia.paseo.km)}
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

      {tieneAlgunaParada &&
        (puntos.length === 0 ? (
          // map-ac5: un día sin ninguna parada resuelta no tiene mapa, y se
          // explica por qué en vez de dejar un hueco mudo.
          <p className="mapa-sin-paradas">Sin mapa: ninguna parada de este día se ha podido ubicar todavía.</p>
        ) : (
          <div className="seccion-mapa-dia">
            <MapaDia
              puntos={puntos}
              paradaActivaId={paradaActivaId}
              onSeleccionarParada={seleccionarParada}
              idsVisitados={idsVisitados}
              centroParadaId={siguienteParada?.id ?? null}
            />
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
                  <li
                    key={parada.id}
                    ref={(elemento) => {
                      if (elemento) refsTarjetas.current.set(parada.id, elemento);
                      else refsTarjetas.current.delete(parada.id);
                    }}
                    className="tarjeta-parada"
                    // map-ac2: tocar el marcador correspondiente en el mapa
                    // marca esta tarjeta con aria-current (la anterior lo
                    // pierde) y la desplaza a la vista.
                    aria-current={parada.id === paradaActivaId ? "true" : undefined}
                  >
                    <IconoFranja franjaId={franja.id} />
                    <div>
                      <strong>{parada.nombre}</strong>
                      <p>{parada.descripcion}</p>
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
                          Ubicación comprobada en {parada.procedencia.fuente === "osm" ? "OpenStreetMap" : "Wikipedia"}{" "}
                          <a
                            href={parada.procedencia.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Ver en ${parada.procedencia.fuente === "osm" ? "OpenStreetMap" : "Wikipedia"}: ${parada.nombre}`}
                          >
                            <span aria-hidden="true">↗</span>
                          </a>
                        </p>
                      )}
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
                      {paradaConPanelAbiertoId === parada.id && (parada.alternativas ?? []).length > 0 && (
                        <div className="panel-alternativas" role="region" aria-label={`Alternativas a ${parada.nombre}`}>
                          <p className="ayuda-alternativas">
                            Cambiar una parada crea una nueva versión del plan; podrás volver a la anterior desde esta
                            misma lista.
                          </p>
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
                                      disabled={!alternativa.id}
                                      onClick={() => alternativa.id && usarAlternativa(parada.id, alternativa.id)}
                                    >
                                      Usar esta
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function VistaPlan({ id }: { id: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  // alt-ac5: recargar (tras usar una alternativa) es volver a pedir
  // /api/plan/[id] -- esa ruta devuelve siempre la versión más reciente,
  // así que no hace falta nada más que repetir la misma petición.
  const [recargarContador, setRecargarContador] = useState(0);
  const [dialogoRegenerarAbierto, setDialogoRegenerarAbierto] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  const [errorRegenerar, setErrorRegenerar] = useState<string | null>(null);

  // reg-ac1: "Cancelar" no toca `trabajos` -el POST solo sale del botón "Sí,
  // regenerar"-; reg-ac3 pone en `errorRegenerar` el mensaje exacto que
  // devuelve el servidor (409 ya en curso, 429 demasiado pronto).
  async function confirmarRegenerar() {
    setRegenerando(true);
    setErrorRegenerar(null);
    try {
      const respuesta = await fetch(`/api/plan/${id}/regenerar`, { method: "POST" });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        setErrorRegenerar(typeof datos?.error === "string" ? datos.error : ERROR_REGENERAR_GENERICO);
        return;
      }
      router.push(`/trabajos/${datos.trabajo_id}`);
    } catch {
      setErrorRegenerar(ERROR_REGENERAR_GENERICO);
    } finally {
      setRegenerando(false);
    }
  }

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const respuesta = await fetch(`/api/plan/${id}`);
        if (!respuesta.ok) {
          if (!cancelado)
            setError("No se ha podido cargar el plan. Vuelve a intentarlo en un momento; esta misma dirección seguirá funcionando.");
          return;
        }
        const datos: PlanPublico = await respuesta.json();
        if (!cancelado) setPlan(datos);
      } catch {
        if (!cancelado)
          setError(
            "No se ha podido cargar el plan: revisa tu conexión y vuelve a intentarlo. Esta misma dirección seguirá funcionando cuando la recuperes.",
          );
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [id, recargarContador]);

  return (
    <div className="pila">
      <p role="note">{AVISO_FIJO}</p>
      {/* usabilidad-ac8(b): el mismo aviso de "guarda esta dirección" que en
          /trabajos/[id]. txt-ac1: la cuenta sí existe -la crea el código de
          acceso-, pero todavía no hay ninguna lista de viajes que recuerde
          esta dirección por el usuario, así que sigue siendo la única forma
          de volver aquí. */}
      <div className="aviso">
        <p>Esta dirección es la única forma de volver a este plan: consérvala.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && !plan && <p>Cargando el plan…</p>}

      {/* final-ac2: PlanPublico ya traía `destino` (aPlanPublico lo sirve
          desde el bloque generacion) pero nadie lo pintaba -el enlace nuevo
          desde la pantalla de progreso es el primer sitio que necesita que
          esta página se reconozca por su contenido, no solo por la URL. */}
      {plan && (
        <div className="fila">
          <h2>{plan.destino}</h2>
          {/* ics-ac2: enlace de descarga directo, sin JS -- `download` basta
              porque la petición es same-origin y lleva la cookie de sesión
              igual que cualquier navegación. */}
          <a className="boton" href={`/api/plan/${id}/calendario.ics`} download aria-describedby="ayuda-calendario">
            Añadir al calendario
          </a>
          <p id="ayuda-calendario" className="ayuda">
            Descarga un fichero .ics que puedes abrir en Google Calendar o en el calendario del móvil
          </p>
          <button type="button" aria-describedby="ayuda-regenerar" onClick={() => setDialogoRegenerarAbierto(true)}>
            Regenerar este viaje
          </button>
          {/* usabilidad-ac8: nada de `title` -sin hover en táctil-; la
              ayuda va en un elemento visible al que aria-describedby apunta. */}
          <p id="ayuda-regenerar" className="ayuda">
            {AYUDA_REGENERAR}
          </p>
        </div>
      )}

      {/* reg-ac4: aviso visible en la versión anterior, todavía la que ve
          el usuario, mientras el trabajo sigue en vuelo. */}
      {plan?.regenerando && (
        <div className="aviso">
          <p>
            Este viaje se está regenerando; el plan que ves se sustituirá cuando termine.{" "}
            <a href={`/trabajos/${plan.trabajoId}`}>Ver el progreso</a>
          </p>
        </div>
      )}

      {/* man-ac1: el contador se muestra siempre que hay plan, resuelto o
          no -- durante los primeros minutos del barrido es el único
          indicio de que algo sigue trabajando. */}
      {plan && (
        <AvisoCiudad
          planId={id}
          ciudad={plan.ciudad}
          totalParadas={plan.dias.reduce((total, dia) => total + dia.paradas.length, 0)}
          paradasUbicadas={plan.dias.reduce((total, dia) => total + dia.paradas.filter((parada) => !!parada.coordenadas).length, 0)}
          onGuardada={() => setRecargarContador((n) => n + 1)}
        />
      )}

      {dialogoRegenerarAbierto && (
        <div role="dialog" aria-label="Regenerar este viaje" className="aviso">
          <p>{TEXTO_CONFIRMACION_REGENERAR}</p>
          <div className="fila">
            <button type="button" autoFocus onClick={() => setDialogoRegenerarAbierto(false)} disabled={regenerando}>
              Cancelar
            </button>
            <button type="button" className="boton-peligro" onClick={() => void confirmarRegenerar()} disabled={regenerando}>
              {regenerando ? "Regenerando…" : "Sí, regenerar"}
            </button>
          </div>
          {errorRegenerar && <p role="alert">{errorRegenerar}</p>}
        </div>
      )}

      {plan?.avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}

      {plan?.dias.map((dia) => (
        <SeccionDia key={dia.fecha} dia={dia} planId={id} onPlanActualizado={() => setRecargarContador((n) => n + 1)} />
      ))}

      {plan && (
        <section aria-label="Recomendaciones" className="seccion-recomendaciones">
          <h2>Recomendaciones</h2>
          {(plan.recomendaciones ?? []).length === 0 ? (
            // reco-ac7(b): un plan sin recomendaciones sigue siendo un plan
            // completo -el hueco se explica, no se calla ni se esconde.
            <p>No hay recomendaciones de sitios para este plan todavía.</p>
          ) : (
            <>
              <p role="note">{AVISO_RECOMENDACIONES}</p>
              <ul className="pila">
                {(plan.recomendaciones ?? []).map((reco, indice) => (
                  <li key={`${reco.tipo}-${indice}-${reco.nombre}`} className="tarjeta-recomendacion">
                    <IconoRecomendacion tipo={reco.tipo} />
                    <div>
                      {/* reco-ac4: el nombre del sitio es el nombre accesible
                          del enlace; abre en pestaña nueva porque saca al
                          usuario de la herramienta hacia un mapa externo. */}
                      <a href={urlBusquedaSitio(reco.nombre, plan.destino)} target="_blank" rel="noopener noreferrer">
                        {reco.nombre}
                      </a>
                      <p>{reco.motivo}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
