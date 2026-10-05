"use client";

import { enlacesTransporte } from "@/lib/etapas/enlaces";
import { formatearFechaCorta, textoTraslado, type RutaViaje as Ruta } from "@/lib/etapas/ruta";
import { formatearEuros } from "@/lib/presupuesto/texto";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";

export const TEXTO_SIN_AJUSTES = "El reparto cumple las reglas de descanso sin ajustes";

interface Props {
  ruta: Ruta;
  presupuesto?: PresupuestoPublico;
  onIrADia: (indiceDia: number) => void;
}

// etv-ac1/etv-ac4: solo pinta lo que calcularRuta ya resolvió. Los enlaces de
// transporte los abre el viajero; pintar esta sección no hace ninguna petición.
export function RutaViaje({ ruta, presupuesto, onIrADia }: Props) {
  const ajustes = ruta.etapas.flatMap((e) => e.ajustes);
  return (
    <section aria-label="Ruta del viaje" className="ruta-viaje" data-testid="ruta-viaje">
      <h2>Ruta del viaje</h2>
      <ol className="pila">
        {ruta.etapas.map((etapa) => (
          <li key={etapa.indice} className="etapa-ruta">
            {etapa.traslado_entrada && (
              <div className="traslado-ruta" data-testid="traslado-ruta">
                <p>{textoTraslado(etapa.traslado_entrada)}</p>
                <ul className="pila enlaces-transporte">
                  {enlacesTransporte(etapa.traslado_entrada, etapa.fecha_llegada, {
                    origen: ruta.etapas[etapa.indice - 1]?.pais,
                    destino: etapa.pais,
                  }).map((enlace) => (
                    <li key={enlace.href}>
                      <a className="boton" href={enlace.href} target="_blank" rel="noopener noreferrer" aria-label={enlace.nombreAccesible}>
                        {enlace.etiqueta}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="tarjeta-etapa" data-testid="etapa-ruta">
              <h3>
                <button type="button" className="enlace-boton" onClick={() => onIrADia(etapa.dia_inicio)}>
                  {etapa.ciudad} · {etapa.noches} {etapa.noches === 1 ? "noche" : "noches"}
                </button>
              </h3>
              <p className="ayuda">
                {etapa.pais}
                {etapa.fecha_inicio && etapa.fecha_fin ? ` · ${formatearFechaCorta(etapa.fecha_inicio)} – ${formatearFechaCorta(etapa.fecha_fin)}` : ""}
              </p>
              {etapa.motivo && (
                <p>
                  <strong>Por qué esta ciudad</strong> <span className="etiqueta-modelo">Lo dice el planificador</span>
                  <br />
                  {etapa.motivo}
                </p>
              )}
              <p className="presupuesto-etapa">
                Etapa: ~{formatearEuros(etapa.subtotal_eur)} (alojamiento ~{formatearEuros(etapa.alojamiento_eur)}, visitas ~{formatearEuros(etapa.visitas_eur)}) · estimado
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="presupuesto-ruta" data-testid="presupuesto-ruta">
        Suma de la ruta: ~{formatearEuros(ruta.suma_visible_eur)} (etapas más traslados ~{formatearEuros(ruta.traslados_eur)})
        {presupuesto && presupuesto.total_de_fuente_eur > 0
          ? ` · de ellos ~${formatearEuros(presupuesto.total_de_fuente_eur)} con precio de fuente y el resto estimado`
          : " · todo estimado"}
      </p>
      <div className="ajustes-planificador" data-testid="ajustes-planificador">
        <h3>Ajustes del planificador</h3>
        {ajustes.length === 0 ? (
          <p>{TEXTO_SIN_AJUSTES}</p>
        ) : (
          <ul className="pila">
            {ajustes.map((ajuste) => (
              <li key={ajuste}>{ajuste}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
