import type { ElementoFijo } from "@/lib/reservas/enElDia";
import { horaDeMinutos } from "@/lib/plan/tiempos";
import { TEXTOS_RESERVAS as T } from "@/lib/textos/reservas";

const TITULO: Record<ElementoFijo["clase"], (f: ElementoFijo) => string> = {
  llegada: () => T.llegada,
  salida: () => T.salida,
  entrada: () => T.entrada,
  hotel: () => T.hotel,
};

// Una reserva con hora dentro del día: fija, sin controles de orden ni de
// arreglo. Si no es del dueño, `detalle` no existe y solo se ve el tipo y la hora.
export function TarjetaReserva({ fijo }: { fijo: ElementoFijo }) {
  const hora = fijo.sinHora ? undefined : horaDeMinutos(fijo.desdeMin);
  return (
    <li className="tarjeta-parada tarjeta-reserva" data-testid="tarjeta-reserva" data-clase={fijo.clase}>
      <span aria-hidden="true" className="candado-reserva">
        🔒
      </span>
      <div className="cuerpo-parada">
        <p className="hora-reserva">{T.tarjetaFija(TITULO[fijo.clase](fijo), hora)}</p>
        {fijo.detalle && (
          <p className="detalle-reserva" data-sensible>
            {fijo.detalle}
          </p>
        )}
        <p className="ayuda">{T.fija}</p>
      </div>
    </li>
  );
}
