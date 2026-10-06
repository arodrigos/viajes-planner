import { enlacesDeParada, type ParadaConEnlaces } from "@/lib/plan/enlacesParada";
import type { Tramo } from "@/lib/plan/tramos";

// enl-ac1: todas las tarjetas, también Comida y Cena, pasan por aquí; los
// enlaces abren en pestaña nueva porque sacan al usuario hacia un sitio externo.
// tramos-dia: «Cómo ir desde la anterior» solo existe si hay una parada
// anterior resuelta, y lleva el medio propuesto para ese tramo.
export function EnlacesParada({ parada, ciudad, tramo }: { parada: ParadaConEnlaces; ciudad: string; tramo?: Tramo }) {
  return (
    <ul className="enlaces-parada" aria-label={`Enlaces de ${parada.nombre}`}>
      {enlacesDeParada(parada, ciudad).map((enlace) => (
        <li key={enlace.href}>
          <a href={enlace.href} target="_blank" rel="noopener noreferrer">
            {enlace.etiqueta}
          </a>
        </li>
      ))}
      {tramo && (
        <li>
          <a href={tramo.href} target="_blank" rel="noopener noreferrer">
            Cómo ir desde la anterior
          </a>
        </li>
      )}
    </ul>
  );
}
