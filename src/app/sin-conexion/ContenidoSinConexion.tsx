"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";
import { ID_PLAN } from "@/lib/sinConexion/reglas";
import { existeCopia, listarPlanesGuardados, type PlanGuardado } from "@/lib/sinConexion/guardados";
import { formatearFechaDia } from "@/lib/plan/dias";


// Enlaces con <a> y no con Link: sin red una navegación RSC no tiene a quién
// preguntar, y la navegación completa es la que atiende el service worker.
function ListaGuardados() {
  const [planes, setPlanes] = useState<PlanGuardado[] | null>(null);
  useEffect(() => {
    void listarPlanesGuardados().then(setPlanes, () => setPlanes([]));
  }, []);
  return (
    <>
      <h1>Planes guardados en este dispositivo</h1>
      {planes === null && <p>Buscando…</p>}
      {planes?.length === 0 && <p>Aún no hay planes guardados en este dispositivo. Abre un plan con conexión y quedará disponible aquí.</p>}
      {planes && planes.length > 0 && (
        <ul className="pila">
          {planes.map((p) => (
            <li key={p.id}>
              <a href={`/sin-conexion?plan=${p.id}`}>
                <strong>{p.destino}</strong> · {formatearFechaDia(p.desde)} – {formatearFechaDia(p.hasta)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PlanGuardadoONo({ id }: { id: string }) {
  const [estado, setEstado] = useState<"comprobando" | "ver" | "ausente">("comprobando");
  useEffect(() => {
    void existeCopia(id)
      .catch(() => false)
      // Con red, aunque no haya copia, el plan se pide de verdad.
      .then((hay) => setEstado(hay || navigator.onLine ? "ver" : "ausente"));
  }, [id]);
  if (estado === "comprobando") return <h1>Tu plan de viaje</h1>;
  if (estado === "ver") return <VistaPlan id={id} />;
  return (
    <>
      <h1>Plan no guardado</h1>
      <p>Este plan no está guardado en este dispositivo. Ábrelo una vez con conexión para tenerlo disponible.</p>
      <a href="/sin-conexion">Planes guardados en este dispositivo</a>
    </>
  );
}

export function ContenidoSinConexion() {
  const plan = useSearchParams().get("plan");
  if (plan && new RegExp(`^${ID_PLAN}$`).test(plan)) return <PlanGuardadoONo id={plan} />;
  return <ListaGuardados />;
}
