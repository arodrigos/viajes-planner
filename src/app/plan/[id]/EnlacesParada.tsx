import { enlacesDeParada, type ParadaConEnlaces } from "@/lib/plan/enlacesParada";

// enl-ac1: todas las tarjetas, también Comida y Cena, pasan por aquí; los
// enlaces abren en pestaña nueva porque sacan al usuario hacia un sitio externo.
export function EnlacesParada({ parada, ciudad }: { parada: ParadaConEnlaces; ciudad: string }) {
  return (
    <ul className="enlaces-parada" aria-label={`Enlaces de ${parada.nombre}`}>
      {enlacesDeParada(parada, ciudad).map((enlace) => (
        <li key={enlace.href}>
          <a href={enlace.href} target="_blank" rel="noopener noreferrer">
            {enlace.etiqueta}
          </a>
        </li>
      ))}
    </ul>
  );
}
