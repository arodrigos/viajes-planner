import { formatearKm, formatearMinutos } from "@/lib/formato/numeros";
import { ETIQUETA_MODO, type Tramo } from "@/lib/plan/tramos";

// tramos-dia (tra-ac2/ac3): medio, tiempo y enlace entre dos paradas. El «≈»
// es el rótulo de estimación; su explicación vive una sola vez en «Cómo leer
// este plan» y no se repite en cada día.
export function ConectorTramo({ tramo }: { tramo: Tramo }) {
  return (
    <li className="tramo-parada" data-testid="tramo-parada">
      <span aria-hidden="true" className="icono-tramo">
        {tramo.modo === "a-pie" ? "🚶" : "🚌"}
      </span>{" "}
      ≈ {formatearMinutos(tramo.minutos)} · {formatearKm(tramo.km)} · {ETIQUETA_MODO[tramo.modo]}{" "}
      <a href={tramo.href} target="_blank" rel="noopener noreferrer">
        Cómo ir
      </a>
    </li>
  );
}
