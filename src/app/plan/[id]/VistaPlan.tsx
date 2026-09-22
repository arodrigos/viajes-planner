"use client";

import { useEffect, useState } from "react";
import { IconoFranja } from "./iconosFranja";

interface FranjaPublica {
  id: string;
  etiqueta: string;
}

interface ParadaPublica {
  id: string;
  franja_id: string;
  nombre: string;
  descripcion: string;
}

interface DiaPublico {
  fecha: string;
  franjas: FranjaPublica[];
  paradas: ParadaPublica[];
}

interface PlanPublico {
  id: string;
  destino: string;
  dias: DiaPublico[];
  avisos: string[];
}

// vista-ac2: aviso fijo y no descartable -sin ningún control de cierre en
// el DOM-, porque en fase 1 ninguna parada está verificada contra ninguna
// ficha (ver src/lib/plan/tipos.ts): la herramienta no es fuente de
// navegación ni de seguridad, y esconder eso detrás de un botón sería
// mentir por omisión.
const AVISO_FIJO =
  "Ninguna parada está comprobada contra ninguna fuente. Esta herramienta no es una fuente de navegación ni de seguridad.";

export function VistaPlan({ id }: { id: string }) {
  const [plan, setPlan] = useState<PlanPublico | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const respuesta = await fetch(`/api/plan/${id}`);
        if (!respuesta.ok) {
          if (!cancelado)
            setError("No se ha podido cargar el plan. Vuelve a intentarlo en un momento; esta misma dirección seguirá funcionando.");
          return;
        }
        const datos: PlanPublico = await respuesta.json();
        if (!cancelado) setPlan(datos);
      } catch {
        if (!cancelado)
          setError(
            "No se ha podido cargar el plan: revisa tu conexión y vuelve a intentarlo. Esta misma dirección seguirá funcionando cuando la recuperes.",
          );
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [id]);

  return (
    <div className="pila">
      <p role="note">{AVISO_FIJO}</p>
      {/* usabilidad-ac8(b): el mismo aviso de "guarda esta dirección" que en
          /trabajos/[id]. txt-ac1: la cuenta sí existe -la crea el código de
          acceso-, pero todavía no hay ninguna lista de viajes que recuerde
          esta dirección por el usuario, así que sigue siendo la única forma
          de volver aquí. */}
      <div className="aviso">
        <p>Esta dirección es la única forma de volver a este plan: consérvala.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && !plan && <p>Cargando el plan…</p>}

      {/* final-ac2: PlanPublico ya traía `destino` (aPlanPublico lo sirve
          desde el bloque generacion) pero nadie lo pintaba -el enlace nuevo
          desde la pantalla de progreso es el primer sitio que necesita que
          esta página se reconozca por su contenido, no solo por la URL. */}
      {plan && <h2>{plan.destino}</h2>}

      {plan?.avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}

      {plan?.dias.map((dia) => {
        // maq-ac5: un día sin ninguna parada en ninguna franja no se queda
        // mudo -el hueco se explica, en vez de una sección vacía que parece
        // un error de carga.
        const tieneAlgunaParada = dia.paradas.length > 0;
        return (
          <section key={dia.fecha} aria-label={`Día ${dia.fecha}`} className="seccion-dia">
            <h2>{dia.fecha}</h2>
            {!tieneAlgunaParada && (
              <p className="dia-sin-paradas">Todavía no hay paradas planificadas para este día.</p>
            )}
            <div className="tramo-dia">
              {dia.franjas.map((franja) => {
                const paradasDeLaFranja = dia.paradas.filter((parada) => parada.franja_id === franja.id);
                if (paradasDeLaFranja.length === 0) return null;
                return (
                  <div key={franja.id} className="seccion-franja">
                    <div
                      className="cabecera-franja"
                      style={{
                        background: `var(--franja-${franja.id}-fondo, var(--superficie))`,
                        color: `var(--franja-${franja.id}-texto, var(--foreground))`,
                      }}
                    >
                      <IconoFranja franjaId={franja.id} />
                      {/* maq-ac2: la etiqueta va SIEMPRE en texto -el icono y
                          el color de fondo son un refuerzo visual, nunca el
                          único portador de la información. */}
                      <h3>{franja.etiqueta}</h3>
                    </div>
                    <ul className="pila">
                      {paradasDeLaFranja.map((parada) => (
                        <li key={parada.id} className="tarjeta-parada">
                          <IconoFranja franjaId={franja.id} />
                          <div>
                            <strong>{parada.nombre}</strong>
                            <p>{parada.descripcion}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
