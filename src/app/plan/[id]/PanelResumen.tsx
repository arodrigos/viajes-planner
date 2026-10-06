"use client";

import { calcularRuta } from "@/lib/etapas/ruta";
import { textoCabeceraPresupuesto } from "@/lib/presupuesto/texto";
import { formatearFechaDia } from "@/lib/plan/dias";
import { urlBusquedaSitio } from "@/lib/plan/urlBusquedaSitio";
import { IconoRecomendacion } from "./iconosRecomendacion";
import { RutaViaje } from "./RutaViaje";
import { SeccionEventos } from "./SeccionEventos";
import type { PlanPublico } from "./tiposVista";

// reco-ac7(c): cada enlace de esta sección abre una búsqueda y no una reserva.
const AVISO_RECOMENDACIONES = "Cada enlace abre una búsqueda en un mapa, no una reserva ni un listado verificado.";

interface Props {
  plan: PlanPublico;
  onElegirDia: (numero: number) => void;
}

// vista-por-dias: el viaje entero de corrido, sin mapa. Reúne lo que antes
// estaba suelto en la cabecera y al pie de la página.
export function PanelResumen({ plan, onElegirDia }: Props) {
  const presupuesto = plan.presupuesto ? textoCabeceraPresupuesto(plan.presupuesto) : null;
  return (
    <section aria-labelledby="titulo-panel" className="panel-resumen pila" id="panel-resumen">
      <h2 id="titulo-panel" tabIndex={-1}>
        Resumen
      </h2>

      {plan.etapas && plan.etapas.length > 0 && (
        <RutaViaje
          ruta={calcularRuta({ personas: plan.personas ?? 1, dias: plan.dias, etapas: plan.etapas, traslados: plan.traslados })}
          presupuesto={plan.presupuesto}
          onIrADia={(i) => onElegirDia(i + 1)}
        />
      )}

      <section aria-label="Lista de días" className="lista-dias">
        <h3>Días</h3>
        <ol className="pila">
          {plan.dias.map((dia, i) => (
            <li key={dia.fecha} data-testid="resumen-dia">
              <button type="button" className="enlace-boton" onClick={() => onElegirDia(i + 1)}>
                Día {i + 1} · {formatearFechaDia(dia.fecha)}
              </button>
              <p className="ayuda">{dia.paradas.length > 0 ? dia.paradas.map((p) => p.nombre).join(" · ") : "Sin paradas todavía"}</p>
            </li>
          ))}
        </ol>
      </section>

      {presupuesto && (
        <div className="presupuesto-plan" data-testid="presupuesto-plan">
          <p>{presupuesto.resumen}</p>
          {presupuesto.aviso && (
            <p role="note" className="aviso">
              {presupuesto.aviso}
            </p>
          )}
        </div>
      )}

      <SeccionEventos eventos={plan.eventos} />

      <section aria-label="Más sitios recomendados" className="seccion-recomendaciones">
        <h3>Más sitios recomendados</h3>
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
                    {/* reco-ac4: el nombre del sitio es el nombre accesible del
                        enlace; abre en pestaña nueva porque saca al usuario de
                        la herramienta hacia un mapa externo. */}
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
    </section>
  );
}
