"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { diaPorDefecto, hoyEnZona, leerDiaDeUrl, valorParaUrl, type DiaElegido } from "@/lib/plan/dias";
import { eventosDelDia } from "./SeccionEventos";
import { CabeceraPlan } from "./CabeceraPlan";
import { PanelDia } from "./PanelDia";
import { EstadoCopia, FranjaCopia } from "./EstadoCopia";
import { Compartir } from "./Compartir";
import { SeccionReservas } from "./SeccionReservas";
import { ComoLeerPlan } from "./ComoLeerPlan";
import { GuardarMapas } from "./GuardarMapas";
import { PanelResumen } from "./PanelResumen";
import { SelectorDias } from "./SelectorDias";
import { AvisoOrden } from "./AvisoOrden";
import { TEXTOS_ORDEN, useOrdenDia } from "./useOrdenDia";
import { borrarCopiaPlan } from "@/lib/sinConexion/borrar";
import { CABECERA_REINTENTO, REINTENTO_COPIA_MS } from "@/lib/sinConexion/reglas";
import { TEXTOS_COMPARTIR } from "@/lib/textos/compartir";
import type { PlanPublico } from "./tiposVista";

const PLAN_VACIO: PlanPublico = { id: "", version: 0, destino: "", dias: [], avisos: [], recomendaciones: [], regenerando: false, trabajoId: "" };

export function VistaPlan({ id }: { id: string }) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [plan, setPlan] = useState<PlanPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Un 404 con red es que el plan ya no es nuestro (o nunca lo fue): se borra la copia.
  const [sinAcceso, setSinAcceso] = useState(false);
  // Hora de lectura de lo que se está viendo y si viene de la copia del SW.
  const [lectura, setLectura] = useState<{ leidoEn: string | null; esCopia: boolean } | null>(null);
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
        if (respuesta.status === 404) {
          // La copia y el mapa se borran aunque la pantalla ya no esté: es lo que
          // impide seguir viendo sin conexión un plan al que se retiró el acceso.
          await borrarCopiaPlan(id);
          if (!cancelado) {
            setPlan(null);
            setSinAcceso(true);
          }
          return;
        }
        if (!respuesta.ok) {
          if (!cancelado) setError("No se ha podido cargar el plan. Vuelve a intentarlo en un momento.");
          return;
        }
        const datos: PlanPublico = await respuesta.json();
        if (!cancelado) {
          setPlan(datos);
          setError(null);
          setSinAcceso(false);
          setLectura({ leidoEn: respuesta.headers?.get("x-plan-leido-en") ?? null, esCopia: respuesta.headers?.get("x-copia-guardada") === "1" });
        }
      } catch {
        if (!cancelado) setError("No se ha podido cargar el plan: revisa tu conexión y vuelve a intentarlo.");
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [id, recargarContador]);

  const esCopia = lectura?.esCopia === true;
  const soloLectura = plan?.compartido?.rol === "miembro";

  // El plan que devuelve el guardado del orden sustituye al de la pantalla; una
  // copia guardada (sin red) no se reordena: los controles no se pintan.
  const orden = useOrdenDia(plan ?? PLAN_VACIO, (nuevo) => {
    setPlan(nuevo);
    setLectura({ leidoEn: new Date().toISOString(), esCopia: false });
  });

  // Al volver la conexión, la copia se sustituye sola por la versión fresca.
  useEffect(() => {
    if (!esCopia) return;
    const alVolver = () => setRecargarContador((n) => n + 1);
    window.addEventListener("online", alVolver);
    return () => window.removeEventListener("online", alVolver);
  }, [esCopia]);

  // Con la copia en pantalla pero red disponible (lectura lenta que el SW cortó a
  // los 6 s), se reintenta en segundo plano y la copia se cambia por la versión
  // fresca en cuanto llega, sin esperar al evento «online».
  useEffect(() => {
    if (!esCopia) return;
    let cancelado = false;
    let enCurso = false;
    const intentar = async () => {
      if (enCurso || navigator.onLine === false) return;
      enCurso = true;
      try {
        const respuesta = await fetch(`/api/plan/${id}`, { headers: { [CABECERA_REINTENTO]: "1" } });
        if (!respuesta.ok || respuesta.headers.get("x-copia-guardada") === "1") return;
        const datos: PlanPublico = await respuesta.json();
        if (cancelado) return;
        setPlan(datos);
        setError(null);
        setLectura({ leidoEn: respuesta.headers.get("x-plan-leido-en") ?? new Date().toISOString(), esCopia: false });
      } catch {
        // Sigue sin llegar: la copia se queda y se vuelve a intentar.
      } finally {
        enCurso = false;
      }
    };
    void intentar();
    const temporizador = setInterval(intentar, REINTENTO_COPIA_MS);
    return () => {
      cancelado = true;
      clearInterval(temporizador);
    };
  }, [esCopia, id]);

  // Primera visita: el SW toma el control después de cargar, así que ni el plan
  // ni las fotos ya pintadas pasaron por él. Se repiten para que queden guardados.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || navigator.serviceWorker.controller) return;
    const alControlar = () => {
      setRecargarContador((n) => n + 1);
      for (const img of document.querySelectorAll<HTMLImageElement>("img.foto-parada, img.foto-alternativa")) {
        if (img.complete && img.naturalWidth > 0) void fetch(img.currentSrc || img.src, { mode: "cors" }).catch(() => undefined);
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", alControlar, { once: true });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", alControlar);
  }, []);

  const fechas = useMemo(() => plan?.dias.map((d) => d.fecha) ?? [], [plan]);
  const hoy = hoyEnZona(plan?.zona);
  const dePorDefecto = diaPorDefecto(fechas, hoy);
  // El día elegido a mano gana a la URL, y la URL a «hoy»: así recargar
  // conserva el día y un ?dia inválido cae en el valor por defecto.
  const dia: DiaElegido = elegidoPorUsuario ?? leerDiaDeUrl(parametros.get("dia"), fechas.length) ?? dePorDefecto;

  // La URL refleja siempre el día visible. replaceState y no router.replace:
  // Next lo integra con useSearchParams sin pedir nada al servidor (sin red no
  // habría respuesta RSC), y Atrás sale del plan en vez de recorrer los días.
  const valorUrl = valorParaUrl(dia);
  useEffect(() => {
    if (!plan || parametros.get("dia") === valorUrl) return;
    const url = new URL(window.location.href);
    url.searchParams.set("dia", valorUrl);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [plan, valorUrl, parametros]);

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
      {sinAcceso && (
        <>
          <h1>Tu plan de viaje</h1>
          <p role="alert" data-testid="acceso-retirado">
            {TEXTOS_COMPARTIR.accesoRetirado}
          </p>
          <p>
            <a href="/viajes" className="boton">
              {TEXTOS_COMPARTIR.irAMisViajes}
            </a>
          </p>
        </>
      )}
      {!error && !plan && !sinAcceso && (
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
            soloLectura={soloLectura}
          />
          {esCopia && lectura?.leidoEn ? <FranjaCopia leidoEn={lectura.leidoEn} /> : lectura?.leidoEn ? <EstadoCopia planId={id} leidoEn={lectura.leidoEn} /> : null}
          {!soloLectura && <GuardarMapas planId={id} dias={plan.dias} puedeGuardar={!esCopia} />}
          {!soloLectura && !esCopia && <SeccionReservas planId={id} fechas={fechas} />}
          {!soloLectura && !esCopia && <Compartir planId={id} />}
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
                  version={plan.version}
                  puedeAnadirSitios={!esCopia && !soloLectura}
                  soloLectura={soloLectura}
                  hoy={hoy}
                  zona={plan.zona}
                  onPlanActualizado={() => setRecargarContador((n) => n + 1)}
                  onIrAResumen={() => elegir("resumen")}
                  ordenPendiente={orden.recalculando(indice) ? orden.ordenEnPantalla(indice) : undefined}
                  onMover={esCopia || soloLectura ? undefined : (idParada, direccion) => orden.mover(indice, idParada, direccion)}
                  onOptimizar={esCopia || soloLectura ? undefined : (nuevo, aviso) => (nuevo ? orden.aplicarOrden(indice, nuevo, { inmediato: true, aviso }) : orden.informar(TEXTOS_ORDEN.yaOptimo))}
                  // Soltar es un gesto único: no hay ráfaga que agrupar.
                  onReordenar={esCopia || soloLectura ? undefined : (nuevo) => orden.aplicarOrden(indice, nuevo, { inmediato: true })}
                />
              );
            })()
          )}
          <AvisoOrden orden={orden} />
          {soloLectura && (
            <>
              <GuardarMapas planId={id} dias={plan.dias} puedeGuardar={!esCopia} />
              <ComoLeerPlan />
            </>
          )}
        </>
      )}
    </div>
  );
}
