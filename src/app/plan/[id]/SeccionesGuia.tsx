import type { CuriosidadesParada, GuiaParada } from "@/lib/plan/tipos";
import { ConsejoGuia } from "./ConsejoGuia";

interface Props {
  nombre: string;
  guia?: GuiaParada;
  curiosidades?: CuriosidadesParada;
  // Distingue «aún no se ha consultado» de «se consultó y no había nada».
  intentada: boolean;
}

// guia-abierta (gui-ac1/gui-ac2): cada sección lleva su fuente y su licencia
// y tiene estado vacío propio. El texto es plano (el trabajador lo limpió) y
// React lo pinta como texto, nunca como HTML.
export function SeccionesGuia({ nombre, guia, curiosidades, intentada }: Props) {
  return (
    <div className="guia-parada">
      <div data-testid="guia-parada">
        <p>
          <strong>Consejos de la guía</strong>
        </p>
        {guia ? (
          <>
            <ConsejoGuia texto={guia.consejo} />
            {guia.precio_texto && guia.precio_eur === undefined && <p className="texto-guia">Precio según la guía: {guia.precio_texto}</p>}
            <p className="atribucion-guia">
              Wikivoyage · CC BY-SA{" "}
              <a href={guia.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver en Wikivoyage: ${nombre}`}>
                <span aria-hidden="true">↗</span>
              </a>
            </p>
          </>
        ) : (
          <p className="texto-guia">{intentada ? "La guía no tiene ficha de este sitio" : "Todavía no hemos consultado la guía para este sitio"}</p>
        )}
      </div>
      <div data-testid="curiosidades-parada">
        <p>
          <strong>Curiosidades</strong>
        </p>
        {curiosidades ? (
          <>
            <ul className="texto-guia">
              {curiosidades.frases.map((frase) => (
                <li key={frase}>{frase}</li>
              ))}
            </ul>
            <p className="atribucion-guia">
              Wikipedia · CC BY-SA{" "}
              <a href={curiosidades.url} target="_blank" rel="noopener noreferrer" aria-label={`Ver en Wikipedia: ${nombre}`}>
                <span aria-hidden="true">↗</span>
              </a>
            </p>
          </>
        ) : (
          <p className="texto-guia">{intentada ? "No hay curiosidades en Wikipedia para este sitio" : "Todavía no hemos buscado curiosidades para este sitio"}</p>
        )}
      </div>
      {/* Las opiniones de visitantes no existen en ninguna fuente abierta
          aprobada: se dice, no se inventan. */}
      <p data-testid="opiniones-parada">
        <strong>Opiniones de visitantes:</strong> Sin opiniones de visitantes
      </p>
    </div>
  );
}
