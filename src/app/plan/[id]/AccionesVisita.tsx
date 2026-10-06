"use client";

// dest-ac1..ac3: acciones de "uso en destino" de UNA parada, aisladas en su
// propio componente para poder comprobar con @testing-library/react, sin
// montar la página entera, el caso "sin sesión" que la vista real nunca
// alcanza (la ruta exige sesión antes de llegar aquí -- ver dest-ac3).
export interface PropiedadesAccionesVisita {
  sesionActiva: boolean;
  visitada: boolean;
  tieneUbicacion: boolean;
  cargando: boolean;
  // WCAG 2.5.3: el nombre accesible empieza por el texto visible y añade la
  // parada, para que dos botones iguales en pantalla no suenen igual. Va en
  // aria-label y no en un span oculto: Chromium separa con un espacio un
  // hijo con position:absolute y el nombre saldría «visitada : parada».
  nombreParada: string;
  hrefComoLlegar?: string;
  onMarcar: () => void;
  onDesmarcar: () => void;
}

export const TEXTO_SIN_SESION = "Inicia sesión para marcar paradas visitadas.";
export const TEXTO_SIN_UBICACION = "Sin ubicación comprobada: no se puede calcular cómo llegar.";

export function AccionesVisita({
  sesionActiva,
  visitada,
  tieneUbicacion,
  cargando,
  nombreParada,
  hrefComoLlegar,
  onMarcar,
  onDesmarcar,
}: PropiedadesAccionesVisita) {
  if (!sesionActiva) {
    return <p className="ayuda-visita">{TEXTO_SIN_SESION}</p>;
  }

  return (
    <div className="acciones-visita">
      <button
        type="button"
        className="boton"
        aria-pressed={visitada}
        aria-label={`${visitada ? "Visitada ✓" : "Marcar como visitada"}: ${nombreParada}`}
        disabled={cargando}
        onClick={visitada ? onDesmarcar : onMarcar}
      >
        {visitada ? "Visitada ✓" : "Marcar como visitada"}
      </button>
      {hrefComoLlegar ? (
        <a href={hrefComoLlegar} target="_blank" rel="noopener noreferrer">
          Cómo llegar
        </a>
      ) : (
        !tieneUbicacion && <span className="ayuda-visita">{TEXTO_SIN_UBICACION}</span>
      )}
    </div>
  );
}
