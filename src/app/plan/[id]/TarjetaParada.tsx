"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { ETIQUETA_INTERES } from "@/lib/criterios/intereses";
import { textoPrecioParada } from "@/lib/presupuesto/texto";
import { AccionesVisita } from "./AccionesVisita";
import { ConectorTramo } from "./ConectorTramo";
import { EnlacesParada } from "./EnlacesParada";
import { EstadoSitioPropio, type AccionesSitio } from "./EstadoSitioPropio";
import { FichaGoogle } from "./FichaGoogle";
import { enlacesDeParada } from "@/lib/plan/enlacesParada";
import { procedenciaHorario } from "@/lib/plan/procedenciaHorario";
import { TEXTOS_FICHA } from "@/lib/textos/ficha";
import { TEXTOS_HORARIO } from "@/lib/textos/horario";
import { IconoFranja } from "./iconosFranja";
import { IconoSinFoto } from "./iconoSinFoto";
import { ConsejosYCuriosidades, contarConsejosYCuriosidades } from "./SeccionesGuia";
import { FotoPlan } from "./FotoPlan";
import { TEXTOS_ARRASTRE } from "./arrastre";
import type { ParadaPublica } from "./tiposVista";
import type { Tramo } from "@/lib/plan/tramos";
import type { ErrorParada } from "@/lib/plan/erroresParada";

export type PanelParada = "motivo" | "guia" | "alternativas" | "google";

interface Props {
  planId: string;
  parada: ParadaPublica;
  franjaId: string;
  ciudad: string;
  // Tramo desde la parada anterior del día; la primera no lo trae.
  tramo?: Tramo;
  tarjetaRef: (elemento: HTMLLIElement | null) => void;
  activa: boolean;
  // Cada incremento pide abrir «Alternativas» (el aviso de paseo del día).
  solicitudAlternativas: number;
  // Cada incremento pide abrir el panel de Google (el atajo de la tarjeta Ahora).
  solicitudGoogle: number;
  // Día de hoy en el destino: la antigüedad del horario se mide contra él.
  hoy: string;
  esHoy: boolean;
  esSiguiente: boolean;
  hrefComoLlegar?: string;
  visitaEnCurso: boolean;
  cambiando: { paradaId: string; alternativaId: string } | null;
  // Solo el error de ESTA parada.
  error?: ErrorParada;
  onUsarAlternativa: (alternativaId: string, nombre: string) => Promise<boolean>;
  onAlternarVisita: (visitadaActualmente: boolean) => void;
  // Reordenar el día: sin él (p. ej. la vista sin conexión) no hay número ni botones.
  orden?: { numero: number; esPrimera: boolean; esUltima: boolean; onMover: (direccion: "arriba" | "abajo") => void };
  // Arrastrar para reordenar: solo con `orden` y dentro de ProveedorArrastre.
  // `indice` es la posición dentro de su franja, que es la que el plugin espera.
  arrastre?: { indice: number; reducirMovimiento: boolean };
  // Corregir o quitar un sitio propio; sin él la tarjeta solo enseña su estado.
  sitio?: AccionesSitio;
  // Quien recibe el plan compartido solo lo lee: sin alternativas, ficha de Google ni visitas.
  soloLectura?: boolean;
}

interface PropsCuerpo extends Props {
  asa?: ReactNode;
  arrastrando?: boolean;
}

// tar-ac1: lo que decide el usuario (foto, nombre, hora, descripción, precio,
// si está comprobada y el tramo) va a la vista; lo demás, en tres paneles
// nativos <details name> que el navegador mantiene exclusivos. El estado se
// sincroniza con onToggle para poder abrir uno por código sin pelearse con el
// navegador.
export function TarjetaParada(props: Props) {
  return props.orden && props.arrastre ? <TarjetaOrdenable {...props} /> : <CuerpoTarjeta {...props} />;
}

// useSortable no puede llamarse condicionalmente: va en su propio componente,
// y así una tarjeta sin arrastre (vista sin conexión, fallo de la librería) no
// necesita proveedor.
function TarjetaOrdenable(props: Props) {
  const { parada, franjaId, arrastre, tarjetaRef } = props;
  const { ref, handleRef, isDragging } = useSortable({
    id: parada.id,
    index: arrastre!.indice,
    group: franjaId,
    transition: arrastre!.reducirMovimiento ? null : undefined,
  });
  // La misma <li> la necesitan PanelDia (foco y scroll) y el plugin.
  const unir = useCallback(
    (elemento: HTMLLIElement | null) => {
      ref(elemento);
      tarjetaRef(elemento);
    },
    [ref, tarjetaRef],
  );
  const asa = (
    <button type="button" ref={handleRef} className="boton boton-orden asa-arrastre" aria-label={TEXTOS_ARRASTRE.asa(parada.nombre)} data-testid="asa-arrastre">
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );
  return <CuerpoTarjeta {...props} tarjetaRef={unir} asa={asa} arrastrando={isDragging} />;
}

function CuerpoTarjeta({ planId, parada, franjaId, ciudad, tramo, tarjetaRef, activa, solicitudAlternativas, solicitudGoogle, hoy, esHoy, esSiguiente, hrefComoLlegar, visitaEnCurso, cambiando, error, onUsarAlternativa, onAlternarVisita, orden, sitio, soloLectura = false, asa, arrastrando }: PropsCuerpo) {
  const [abierto, setAbierto] = useState<PanelParada | null>(null);
  const [fotoFallida, setFotoFallida] = useState(false);
  const alternativas = parada.alternativas ?? [];
  const nombreGrupo = `parada-${parada.id}`;

  // Ajuste de estado durante el render (patrón de la documentación de React)
  // en vez de un efecto: cada petición nueva del aviso de paseo abre el panel.
  const [solicitudAtendida, setSolicitudAtendida] = useState(0);
  if (solicitudAlternativas !== solicitudAtendida) {
    setSolicitudAtendida(solicitudAlternativas);
    if (solicitudAlternativas > 0) setAbierto("alternativas");
  }

  // El navegador cierra el panel anterior y dispara su toggle a la vez que el
  // del nuevo; el orden no está garantizado, así que un cierre solo borra el
  // estado si sigue siendo el de ese panel.
  function alAlternar(panel: PanelParada) {
    return (evento: React.SyntheticEvent<HTMLDetailsElement>) => {
      const abiertoAhora = evento.currentTarget.open;
      setAbierto((previo) => (abiertoAhora ? panel : previo === panel ? null : previo));
    };
  }

  const [googleAtendida, setGoogleAtendida] = useState(0);
  if (solicitudGoogle !== googleAtendida) {
    setGoogleAtendida(solicitudGoogle);
    if (solicitudGoogle > 0) setAbierto("google");
  }

  async function usar(alternativaId: string, nombre: string) {
    const hecho = await onUsarAlternativa(alternativaId, nombre);
    if (hecho) setAbierto(null);
  }

  const hrefMaps = enlacesDeParada(parada, ciudad)[0].href;
  const procedencia = procedenciaHorario({
    fechaComprobacion: parada.horario?.fuenteOsm?.comprobadoEn,
    tieneHorario: Boolean(parada.horario?.fuenteOsm),
    hoy,
    casada: parada.google?.estado === "casado",
    posibleCierre: Boolean(parada.horario?.posibleCierre),
  });
  const nConsejos = contarConsejosYCuriosidades(parada.guia, parada.curiosidades);
  // Un sitio propio aún sin ubicar no tiene precio, guía ni ficha de las que
  // hablar: solo su nota y cómo va la búsqueda.
  const propia = parada.propia === true;
  const sinResolver = propia && parada.estadoSitio !== "resuelto";
  const sinEscritura = sinResolver || soloLectura;

  return (
    <Fragment>
      {tramo && <ConectorTramo tramo={tramo} />}
      <li
        ref={tarjetaRef}
        className="tarjeta-parada"
        tabIndex={-1}
        // map-ac2: tocar el marcador correspondiente en el mapa marca esta
        // tarjeta con aria-current y la desplaza a la vista.
        aria-current={activa ? "true" : undefined}
        data-arrastrando={arrastrando ? "true" : undefined}
      >
        <IconoFranja franjaId={franjaId} />
        <div className="cuerpo-parada">
          <div className="cabeza-parada">
            {/* fot-ac2/fot-ac3: la foto procede de resolverFotos.ts (server-only); sin
                ella, el marcador de posición es digno, nunca un hueco roto. */}
            {parada.foto ? (
              <FotoPlan src={parada.foto.url} alt={parada.nombre} className="foto-parada" width={88} height={88} alFallar={() => setFotoFallida(true)} />
            ) : (
              <div className="foto-ausente">
                <IconoSinFoto />
                <span>Sin foto</span>
              </div>
            )}
            <div>
              {orden && <span className="numero-parada" data-testid="numero-parada">{orden.numero}</span>}
              <h4>{parada.nombre}</h4>
              {parada.horario && (
                <p className="horario-parada" data-testid="horario-parada">
                  <time>{parada.horario.inicio} – {parada.horario.fin}</time>
                  {" · "}
                  {parada.horario.apertura}
                  {parada.horario.aviso && <span className="aviso-horario"> · {parada.horario.aviso}</span>}
                </p>
              )}
              {procedencia.rotulo && (
                <p className="procedencia-horario" data-testid="procedencia-horario">
                  {procedencia.rotulo}
                  {procedencia.aviso && ` · ${procedencia.aviso}`}
                </p>
              )}
              {/* dif-ac2: abre el panel de esta misma tarjeta; si ya estaba montado no hay otra reserva. */}
              {procedencia.ofrecerGoogle && (
                <button type="button" className="boton" data-testid="comprobar-en-google" onClick={() => setAbierto("google")}>
                  {TEXTOS_HORARIO.comprobarEnGoogle.texto}
                </button>
              )}
            </div>
          </div>
          {parada.descripcion && <p>{parada.descripcion}</p>}
          {/* La nota es del usuario: texto plano, React la escapa. */}
          {parada.nota && (
            <p className="nota-sitio" data-testid="nota-sitio">
              {parada.nota}
            </p>
          )}
          {propia && <EstadoSitioPropio parada={parada} acciones={sitio} />}
          {!sinResolver && (
            <p className="precio-parada" data-testid="precio-parada">
              {textoPrecioParada(parada.coste)}
            </p>
          )}
          {/* tar-ac4: la procedencia y el crédito de la foto nunca se pliegan:
              uno es honestidad sobre el dato, el otro condición de licencia. */}
          {sinResolver ? null : parada.procedencia.fuente === "propuesto-sin-verificar" ? (
            <p className="procedencia-parada procedencia-sin-comprobar">
              Sin comprobar: revisa nombre y dirección antes de ir.
            </p>
          ) : (
            <p className="procedencia-parada">
              Ubicación comprobada en {parada.procedencia.fuente === "osm" ? "OpenStreetMap" : "Wikipedia"}
            </p>
          )}
          {parada.foto && !fotoFallida && (
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
          )}

          {/* mot-ac1: el motivo va rotulado como del modelo -es su opinión, no un dato
              comprobado-; sin motivo (plan anterior) el panel no aparece. */}
          {!sinResolver && (parada.motivo || parada.interes) && (
            <details name={nombreGrupo} className="panel-parada" open={abierto === "motivo"} onToggle={alAlternar("motivo")}>
              <summary>Por qué te lo proponemos</summary>
              <div className="motivo-parada" data-testid="motivo-parada">
                <p className="etiqueta-modelo">Lo dice el planificador</p>
                {parada.motivo && <p className="texto-motivo">{parada.motivo}</p>}
                {parada.interes && (
                  <p className="interes-parada" data-testid="interes-parada">
                    Encaja con tu interés: {ETIQUETA_INTERES[parada.interes]}
                  </p>
                )}
              </div>
            </details>
          )}

          {!sinResolver && (
          <details name={nombreGrupo} className="panel-parada" open={abierto === "guia"} onToggle={alAlternar("guia")}>
            <summary>{nConsejos > 0 ? `Consejos y curiosidades (${nConsejos})` : "Consejos y curiosidades"}</summary>
            <ConsejosYCuriosidades
              nombre={parada.nombre}
              guia={parada.guia}
              curiosidades={parada.curiosidades}
              intentada={Boolean(parada.guia_intentada_en)}
            />
          </details>
          )}

          {/* cam-ac1: el panel solo existe si hay a qué cambiar; el aviso de paseo
              puede pedirlo en una parada sin alternativas y entonces explica por qué. */}
          {!sinEscritura && (alternativas.length > 0 || solicitudAlternativas > 0) && (
            <details name={nombreGrupo} className="panel-parada" open={abierto === "alternativas"} onToggle={alAlternar("alternativas")}>
              <summary>{`Alternativas (${alternativas.length})`}</summary>
              {/* Solo se pinta abierto: sus fotos no se piden hasta que el usuario las pide. */}
              {abierto === "alternativas" && (
                <div
                  className="panel-alternativas"
                  role="region"
                  aria-label={`Alternativas a ${parada.nombre}`}
                  aria-busy={cambiando?.paradaId === parada.id ? "true" : undefined}
                >
                  {cambiando?.paradaId === parada.id && <p role="status">Cambiando la parada…</p>}
                  {error?.tipo === "cambio" && <p role="alert" className="mensaje-error">{error.mensaje}</p>}
                  <p className="ayuda-alternativas">
                    Cambiar una parada crea una nueva versión del plan; podrás volver a la anterior desde esta misma lista.
                  </p>
                  {alternativas.length === 0 ? (
                    <div className="alternativas-vacio">
                      <p>No hay alternativas comprobadas para esta parada.</p>
                      <p className="ayuda-alternativas">
                        Las alternativas salen al generar el plan; los viajes anteriores no las tienen. Puedes regenerar este
                        viaje desde el menú del plan para obtenerlas.
                      </p>
                    </div>
                  ) : (
                  <ul className="pila lista-alternativas">
                    {alternativas.map((alternativa, indice) => (
                      <li key={alternativa.id ?? `${parada.id}-${indice}`} className="tarjeta-alternativa">
                        {alternativa.foto ? (
                          <FotoPlan src={alternativa.foto.url} alt={alternativa.nombre} className="foto-alternativa" />
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
                            onClick={() => alternativa.id && usar(alternativa.id, alternativa.nombre)}
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
            </details>
          )}

          {/* fic-ac1: el panel nunca está en /guia (pública). FichaGoogle no pide nada
              hasta que se abre por primera vez y se queda montada al cerrarlo. */}
          {!sinEscritura && (
          <details name={nombreGrupo} className="panel-parada" open={abierto === "google"} onToggle={alAlternar("google")}>
            <summary>{TEXTOS_FICHA.panel.texto}</summary>
            <FichaGoogle planId={planId} paradaId={parada.id} estado={parada.google?.estado} abierto={abierto === "google"} hrefMaps={hrefMaps} conFotos={!parada.foto} />
          </details>
          )}

          {/* WCAG 2.5.7: los botones son la vía principal de reordenar; el
              arrastre es un añadido, nunca la única forma. */}
          {orden && (
            <div className="controles-orden">
              {asa}
              <button type="button" className="boton boton-orden" aria-label={`Subir «${parada.nombre}»`} disabled={orden.esPrimera} onClick={() => orden.onMover("arriba")}>
                <span aria-hidden="true">↑</span> Subir
              </button>
              <button type="button" className="boton boton-orden" aria-label={`Bajar «${parada.nombre}»`} disabled={orden.esUltima} onClick={() => orden.onMover("abajo")}>
                <span aria-hidden="true">↓</span> Bajar
              </button>
            </div>
          )}

          <EnlacesParada parada={parada} ciudad={ciudad} tramo={tramo} />
          {/* dest-ac1..ac3: solo el día de hoy -- un día pasado o futuro no
              muestra ningún botón de visita. */}
          {esHoy && !soloLectura && (
            <AccionesVisita
              sesionActiva={true}
              visitada={Boolean(parada.visitada)}
              tieneUbicacion={Boolean(parada.coordenadas)}
              cargando={visitaEnCurso}
              nombreParada={parada.nombre}
              hrefComoLlegar={esSiguiente ? hrefComoLlegar : undefined}
              onMarcar={() => onAlternarVisita(false)}
              onDesmarcar={() => onAlternarVisita(true)}
            />
          )}
          {error?.tipo === "visita" && <p role="alert" className="mensaje-error">{error.mensaje}</p>}
        </div>
      </li>
    </Fragment>
  );
}
