"use client";

import { useEffect, useState } from "react";
import { urlBusquedaSitio } from "@/lib/plan/urlBusquedaSitio";
import { IconoFranja } from "./iconosFranja";
import { IconoRecomendacion } from "./iconosRecomendacion";

interface FranjaPublica {
  id: string;
  etiqueta: string;
}

interface ProcedenciaPublica {
  fuente: "propuesto-sin-verificar" | "osm" | "wikipedia";
  url?: string;
}

interface ParadaPublica {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
  procedencia: ProcedenciaPublica;
}

interface DiaPublico {
  fecha: string;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
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
}

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

export function VistaPlan({ id }: { id: string }) {
  const [plan, setPlan] = useState<PlanPublico | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [id]);

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
      {plan && <h2>{plan.destino}</h2>}

      {plan?.avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}

      {plan?.dias.map((dia) => {
        // maq-ac5: un día sin ninguna parada en ninguna franja no se queda
        // mudo -el hueco se explica, en vez de una sección vacía que parece
        // un error de carga.
        const tieneAlgunaParada = dia.paradas.length > 0;
        return (
          <section key={dia.fecha} aria-label={`Día ${dia.fecha}`} className="seccion-dia">
            <h2>{dia.fecha}</h2>
            {!tieneAlgunaParada && (
              <p className="dia-sin-paradas">Todavía no hay paradas planificadas para este día.</p>
            )}
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
                        <li key={parada.id} className="tarjeta-parada">
                          <IconoFranja franjaId={franja.id} />
                          <div>
                            <strong>{parada.nombre}</strong>
                            <p>{parada.descripcion}</p>
                            {parada.procedencia.fuente === "propuesto-sin-verificar" ? (
                              <p className="procedencia-parada">
                                Sin comprobar. No hemos podido localizar este sitio en los mapas abiertos: comprueba el
                                nombre y la dirección antes de ir.
                              </p>
                            ) : (
                              <p className="procedencia-parada">
                                Ubicación comprobada en {parada.procedencia.fuente === "osm" ? "OpenStreetMap" : "Wikipedia"}{" "}
                                <a href={parada.procedencia.url} target="_blank" rel="noopener noreferrer">
                                  ↗
                                </a>
                              </p>
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
      })}

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
