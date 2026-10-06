"use client";

import { useEffect, useRef, useState } from "react";
import { formatearKm, formatearMinutos } from "@/lib/formato/numeros";
import type { Tramo } from "@/lib/plan/tramos";
import { TEXTOS_AHORA as T } from "@/lib/textos/ahora";
import type { ParadaPublica } from "./tiposVista";

interface Props {
  // Siguiente parada ubicada sin visitar; null si no queda ninguna.
  siguiente: ParadaPublica | null;
  // Hay alguna parada con coordenadas hoy (distingue «todo visitado» de
  // «nada que calcular»).
  hayUbicadas: boolean;
  progreso: { visitadas: number; total: number };
  hrefComoLlegar: string | null;
  tramo?: Tramo;
  marcando: boolean;
  onMarcar: () => void;
  onIrARecomendados: () => void;
}

// hoy-ac1..ac3: solo se monta en el día de hoy (PanelDia). Reutiliza la API
// de visitas de las tarjetas; no pide geolocalización: el origen es la
// última parada visitada.
export function TarjetaAhora({ siguiente, hayUbicadas, progreso, hrefComoLlegar, tramo, marcando, onMarcar, onIrARecomendados }: Props) {
  // El anuncio solo se escribe cuando el progreso SUBE: así no se lee nada
  // al abrir el plan y sí al marcar, con la parada que toca después.
  const visitadasPrevias = useRef(progreso.visitadas);
  const [anuncio, setAnuncio] = useState("");
  useEffect(() => {
    if (progreso.visitadas > visitadasPrevias.current) {
      setAnuncio(siguiente ? `Hecho. Ahora toca ${siguiente.nombre}.` : T.todoVisitado.texto);
    }
    visitadasPrevias.current = progreso.visitadas;
  }, [progreso.visitadas, siguiente]);

  return (
    <section aria-labelledby="titulo-ahora" className="tarjeta-ahora">
      <h3 id="titulo-ahora">{T.titulo.texto}</h3>
      {siguiente ? (
        <>
          <p className="ahora-parada">
            <strong>{siguiente.nombre}</strong>
            {siguiente.horario && <span className="ahora-hora"> · {siguiente.horario.inicio}</span>}
          </p>
          {tramo && (
            <p className="ayuda">
              Desde la anterior: ≈ {formatearMinutos(tramo.minutos)} · {formatearKm(tramo.km)}
            </p>
          )}
          <div className="acciones-visita">
            <button type="button" className="boton boton-principal" disabled={marcando} onClick={onMarcar}>
              {marcando ? T.marcando.texto : T.marcar.texto}
            </button>
            {hrefComoLlegar && (
              <a href={hrefComoLlegar} target="_blank" rel="noopener noreferrer">
                {T.comoLlegar.texto}
              </a>
            )}
          </div>
        </>
      ) : hayUbicadas ? (
        <>
          <p>{T.todoVisitado.texto}</p>
          <button type="button" className="boton" onClick={onIrARecomendados}>
            {T.verRecomendados.texto}
          </button>
        </>
      ) : (
        <p>{T.sinUbicacion.texto}</p>
      )}
      <p className="ayuda">
        {progreso.visitadas} de {progreso.total} visitadas
      </p>
      <p role="status" className="solo-lectores">
        {anuncio}
      </p>
    </section>
  );
}
