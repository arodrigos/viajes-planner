"use client";

import { useEffect, useRef } from "react";
import { formatearFechaChip, type DiaElegido } from "@/lib/plan/dias";

interface Props {
  fechas: string[];
  elegido: DiaElegido;
  hoy: string;
  onElegir: (dia: DiaElegido) => void;
}

// vista-por-dias: chips de enlace en un carril que se desplaza dentro de su
// contenedor (la página no desborda a 390 px). Son enlaces con ?dia para que
// «copiar enlace» y recargar conserven el día; el clic se intercepta para no
// recargar ni añadir entradas al historial.
export function SelectorDias({ fechas, elegido, hoy, onElegir }: Props) {
  const actual = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const chip = actual.current;
    // jsdom no implementa scrollIntoView.
    if (chip && typeof chip.scrollIntoView === "function") chip.scrollIntoView({ block: "nearest", inline: "center" });
  }, [elegido]);

  const chips: { valor: DiaElegido; etiqueta: string; esHoy: boolean }[] = [
    { valor: "resumen", etiqueta: "Resumen", esHoy: false },
    ...fechas.map((f, i) => ({ valor: i + 1, etiqueta: `Día ${i + 1} · ${formatearFechaChip(f)}`, esHoy: f === hoy })),
  ];

  return (
    <nav aria-label="Días del viaje" className="selector-dias">
      <ul className="pila carril-dias">
        {chips.map((chip) => (
          <li key={String(chip.valor)}>
            <a
              ref={chip.valor === elegido ? actual : undefined}
              className="chip-dia"
              href={`?dia=${chip.valor}`}
              aria-current={chip.valor === elegido ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onElegir(chip.valor);
              }}
            >
              {chip.etiqueta}
              {chip.esHoy && <span className="marca-hoy">Hoy</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
