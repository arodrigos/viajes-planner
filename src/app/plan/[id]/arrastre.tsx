"use client";

import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom";
import { DragDropProvider, KeyboardSensor, PointerSensor, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { Component, useState, type ReactNode } from "react";
import { agruparPorFranja, mismoOrden, ordenDesdeGrupos, type EntradaOrden } from "@/lib/plan/reordenar";

// Retardo en táctil y distancia con ratón: sin ellos el asa robaría el
// desplazamiento de la página. La tolerancia deja que el dedo tiemble un poco
// durante la pulsación larga sin cancelarla.
export const RETARDO_TACTIL_MS = 250;
export const DISTANCIA_RATON_PX = 5;

export const TEXTOS_ARRASTRE = {
  instrucciones: "Pulsa Espacio para coger la parada, las flechas arriba y abajo para moverla y Espacio de nuevo para soltarla. Escape cancela.",
  asa: (nombre: string) => `Arrastrar para mover «${nombre}»`,
} as const;

const sensores = [
  PointerSensor.configure({
    activationConstraints: (evento: PointerEvent) =>
      evento.pointerType === "mouse"
        ? [new PointerActivationConstraints.Distance({ value: DISTANCIA_RATON_PX })]
        : [new PointerActivationConstraints.Delay({ value: RETARDO_TACTIL_MS, tolerance: 5 })],
  }),
  KeyboardSensor,
];

export function reducirMovimiento(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Si la librería lanza al montarse o al pintar, la lista vuelve a pintarse sin
// asas: los botones Subir/Bajar siguen siendo la vía principal (WCAG 2.5.7).
class BarreraArrastre extends Component<{ alFallar: ReactNode; children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };
  static getDerivedStateFromError() {
    return { fallo: true };
  }
  render() {
    return this.state.fallo ? this.props.alFallar : this.props.children;
  }
}

interface Props {
  orden: EntradaOrden[];
  franjas: { id: string; etiqueta: string }[];
  nombres: Record<string, string>;
  onReordenar: (orden: EntradaOrden[]) => void;
  // Sin él (vista sin conexión) o si la librería falla, `children(false)`:
  // la misma lista sin asas.
  activo: boolean;
  children: (conAsa: boolean) => ReactNode;
}

export function ProveedorArrastre({ orden, franjas, nombres, onReordenar, activo, children }: Props) {
  // El arrastre en curso se anuncia con el nombre de la parada y su franja.
  const [reducido] = useState(reducirMovimiento);
  const etiquetaDe = new Map(franjas.map((f) => [f.id, f.etiqueta]));
  const nombreDe = (id: unknown) => nombres[String(id)] ?? "parada";
  const franjaDe = (grupo: unknown) => etiquetaDe.get(String(grupo)) ?? "";

  if (!activo) return <>{children(false)}</>;

  return (
    <BarreraArrastre alFallar={children(false)}>
      <DragDropProvider
        sensors={sensores}
        plugins={(defecto) =>
          defecto.map((plugin) => {
            if (plugin === Accessibility) {
              return Accessibility.configure({
                screenReaderInstructions: { draggable: TEXTOS_ARRASTRE.instrucciones },
                announcements: {
                  dragstart: ({ operation }: DragStartEvent) => `Has cogido «${nombreDe(operation.source?.id)}».`,
                  dragover: ({ operation }: DragOverEvent) => {
                    const destino = operation.target;
                    return destino ? `«${nombreDe(operation.source?.id)}» sobre «${nombreDe(destino.id)}».` : undefined;
                  },
                  dragend: ({ operation, canceled }: DragEndEvent) => {
                    const nombre = nombreDe(operation.source?.id);
                    if (canceled) return `Movimiento de «${nombre}» cancelado. Sigue donde estaba.`;
                    const franja = franjaDe((operation.source as { group?: unknown } | null)?.group);
                    return franja ? `Has soltado «${nombre}» en ${franja}.` : `Has soltado «${nombre}».`;
                  },
                },
              });
            }
            if (reducido && plugin === Feedback) return Feedback.configure({ dropAnimation: null });
            return plugin;
          })
        }
        onDragEnd={(evento) => {
          if (evento.canceled) return;
          const nuevo = ordenDesdeGrupos(move(agruparPorFranja(orden, franjas), evento), franjas);
          if (!mismoOrden(orden, nuevo)) onReordenar(nuevo);
        }}
      >
        {children(true)}
      </DragDropProvider>
    </BarreraArrastre>
  );
}
