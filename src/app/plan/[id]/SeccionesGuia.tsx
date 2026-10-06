import type { CuriosidadesParada, GuiaParada } from "@/lib/plan/tipos";
import { ConsejoGuia } from "./ConsejoGuia";

interface Props {
  nombre: string;
  guia?: GuiaParada;
  curiosidades?: CuriosidadesParada;
  // Distingue «aún no se ha consultado» de «se consultó y no había nada».
  intentada: boolean;
}

// Número que acompaña al rótulo del panel: el consejo de la guía cuenta como
// uno y cada curiosidad como otro.
export function contarConsejosYCuriosidades(guia?: GuiaParada, curiosidades?: CuriosidadesParada): number {
  const nCuriosidades = curiosidades ? (curiosidades.items && curiosidades.items.length > 0 ? curiosidades.items.length : curiosidades.frases.length) : 0;
  return (guia ? 1 : 0) + nCuriosidades;
}

// guia-abierta (gui-ac1/gui-ac2): cada sección lleva su fuente y su licencia
// y tiene estado vacío propio. El texto es plano (el trabajador lo limpió) y
// React lo pinta como texto, nunca como HTML.
export function ConsejosYCuriosidades({ nombre, guia, curiosidades, intentada }: Props) {
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
          <p className="texto-guia">
            {intentada ? "La guía no tiene ficha de este sitio" : `Buscando consejos y curiosidades de ${nombre}; aparecerán en unos minutos`}
          </p>
        )}
      </div>
      <div data-testid="curiosidades-parada">
        <p>
          <strong>Curiosidades</strong>
        </p>
        {curiosidades && curiosidades.items && curiosidades.items.length > 0 ? (
          <>
            <ul className="texto-guia lista-curiosidades">
              {curiosidades.items.map((item) => (
                <li key={item.texto}>
                  {/* El texto en inglés se enseña tal cual (sin traducir); lang
                      hace que el lector de pantalla lo pronuncie bien. */}
                  <p className="texto-curiosidad" lang={item.idioma === "en" ? "en" : undefined}>
                    {item.texto}
                  </p>
                  {/* tar-ac3: la atribución y el ↗ van en su propia línea: dentro del
                      párrafo dejaban un hueco en la última línea del texto. */}
                  <p className="atribucion-guia atribucion-curiosidad">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ver en ${item.fuente === "wikidata" ? "Wikidata" : "Wikipedia"}: ${item.texto}`}
                    >
                      {item.fuente === "wikidata" ? "Wikidata" : item.idioma === "en" ? "Wikipedia · en inglés" : "Wikipedia"}{" "}
                      <span aria-hidden="true">↗</span>
                    </a>
                  </p>
                </li>
              ))}
            </ul>
            <p className="atribucion-guia">
              {curiosidades.items.some((i) => i.fuente === "wikipedia") ? "Wikipedia · CC BY-SA" : "Wikidata · CC0"}
              {curiosidades.items.some((i) => i.fuente === "wikipedia") && curiosidades.items.some((i) => i.fuente === "wikidata") ? " · Wikidata · CC0" : ""}
            </p>
          </>
        ) : curiosidades ? (
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
