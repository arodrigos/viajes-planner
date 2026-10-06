"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { diaPorDefecto, hoyEnZona, leerDiaDeUrl, valorParaUrl, type DiaElegido } from "@/lib/plan/dias";
import { eventosDelDia } from "./SeccionEventos";
import { CabeceraPlan } from "./CabeceraPlan";
import { PanelDia } from "./PanelDia";
import { PanelResumen } from "./PanelResumen";
import { SelectorDias } from "./SelectorDias";
import type { PlanPublico } from "./tiposVista";

export function VistaPlan({ id }: { id: string }) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [plan, setPlan] = useState<PlanPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  // alt-ac5: recargar (tras usar una alternativa) es volver a pedir
  // /api/plan/[id] -- esa ruta devuelve siempre la versión más reciente,
  // así que no hace falta nada más que repetir la misma petición.
  const [recargarContador, setRecargarContador] = useState(0);
  const [elegidoPorUsuario, setElegidoPorUsuario] = useState<DiaElegido | null>(null);
  const moverFoco = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const respuesta = await fetch(`/api/plan/${id}`);
        if (!respuesta.ok) {
          if (!cancelado) setError("No se ha podido cargar el plan. Vuelve a intentarlo en un momento.");
          return;
        }
        const datos: PlanPublico = await respuesta.json();
        if (!cancelado) setPlan(datos);
      } catch {
        if (!cancelado) setError("No se ha podido cargar el plan: revisa tu conexión y vuelve a intentarlo.");
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [id, recargarContador]);

  const fechas = useMemo(() => plan?.dias.map((d) => d.fecha) ?? [], [plan]);
  const hoy = hoyEnZona(plan?.zona);
  const dePorDefecto = diaPorDefecto(fechas, hoy);
  // El día elegido a mano gana a la URL, y la URL a «hoy»: así recargar
  // conserva el día y un ?dia inválido cae en el valor por defecto.
  const dia: DiaElegido = elegidoPorUsuario ?? leerDiaDeUrl(parametros.get("dia"), fechas.length) ?? dePorDefecto;

  // La URL refleja siempre el día visible. replace y no push: Atrás sale del
  // plan en vez de recorrer los días vistos.
  const valorUrl = valorParaUrl(dia);
  useEffect(() => {
    if (!plan || parametros.get("dia") === valorUrl) return;
    router.replace(`?dia=${valorUrl}`, { scroll: false });
  }, [plan, valorUrl, parametros, router]);

  // Tras cambiar de día el foco pasa al encabezado del panel, para que un
  // lector de pantalla anuncie dónde está.
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    document.getElementById("titulo-panel")?.focus();
  }, [dia]);

  function elegir(nuevo: DiaElegido) {
    moverFoco.current = true;
    setElegidoPorUsuario(nuevo);
  }

  return (
    <div className="pila">
      {error && <p role="alert">{error}</p>}
      {!error && !plan && (
        <>
          <h1>Tu plan de viaje</h1>
          <p>Cargando el plan…</p>
        </>
      )}

      {plan && (
        <>
          <CabeceraPlan
            plan={plan}
            planId={id}
            onRegenerado={(trabajoId) => router.push(`/trabajos/${trabajoId}`)}
            onCiudadGuardada={() => setRecargarContador((n) => n + 1)}
          />
          <SelectorDias fechas={fechas} elegido={dia} hoy={hoy} onElegir={elegir} />
          {dia === "resumen" ? (
            <PanelResumen plan={plan} onElegirDia={elegir} />
          ) : (
            (() => {
              const indice = dia - 1;
              const diaPlan = plan.dias[indice];
              const etapa = diaPlan.etapa !== undefined ? plan.etapas?.[diaPlan.etapa] : undefined;
              return (
                <PanelDia
                  key={diaPlan.fecha}
                  dia={diaPlan}
                  indice={indice}
                  eventos={eventosDelDia(plan.eventos?.eventos, diaPlan.fecha).filter((e) => diaPlan.etapa === undefined || e.etapa === diaPlan.etapa)}
                  destino={plan.destino}
                  etapa={etapa ? { ciudad: etapa.ciudad.nombre ?? etapa.pais, caja: etapa.ciudad.caja } : undefined}
                  planId={id}
                  hoy={hoy}
                  onPlanActualizado={() => setRecargarContador((n) => n + 1)}
                />
              );
            })()
          )}
        </>
      )}
    </div>
  );
}
