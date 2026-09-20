"use client";

import { useEffect, useState } from "react";

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
          /trabajos/[id], para que quien llega hasta aquí sepa que no hay
          cuenta ni lista de viajes -esta URL es todo lo que hay. */}
      <div className="aviso">
        <p>Esta dirección es la única forma de volver a este plan: consérvala.</p>
      </div>

      {error && <p role="alert">{error}</p>}
      {!error && !plan && <p>Cargando el plan…</p>}

      {plan?.avisos.map((aviso) => (
        <p key={aviso}>{aviso}</p>
      ))}

      {plan?.dias.map((dia) => (
        <section key={dia.fecha} aria-label={`Día ${dia.fecha}`} className="seccion-dia">
          <h2>{dia.fecha}</h2>
          {dia.franjas.map((franja) => {
            const paradasDeLaFranja = dia.paradas.filter((parada) => parada.franja_id === franja.id);
            if (paradasDeLaFranja.length === 0) return null;
            return (
              <div key={franja.id} className="seccion-franja">
                <h3>{franja.etiqueta}</h3>
                <ul className="pila">
                  {paradasDeLaFranja.map((parada) => (
                    <li key={parada.id}>
                      <strong>{parada.nombre}</strong>
                      <p>{parada.descripcion}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
