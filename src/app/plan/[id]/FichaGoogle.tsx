"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { claveNavegador } from "@/lib/google/claveNavegador";
import type { EstadoGoogleParada } from "@/lib/google/estados";
import { interpretarRespuesta, mensajeSinPeticion, TEXTO_MENSAJE_FICHA, type ClaveMensajeFicha } from "@/lib/google/estadoFicha";
import { TEXTOS_FICHA } from "@/lib/textos/ficha";

interface Props {
  planId: string;
  paradaId: string;
  estado: EstadoGoogleParada | undefined;
  // El panel de la tarjeta; no se pide nada a Google hasta la primera apertura.
  abierto: boolean;
  hrefMaps: string;
  // Las fotos de Google son solo respaldo: con foto propia (Commons) la ficha
  // va sin ellas. Cada ficha con fotos cuesta hasta 10 GetPhotoMedia, y el UI
  // Kit no deja pedir menos (gmp-place-media no tiene tope de cantidad).
  conFotos: boolean;
}

type Vista = { tipo: "inactiva" } | { tipo: "cargando" } | { tipo: "ficha" } | { tipo: "mensaje"; mensaje: ClaveMensajeFicha };

// El contenido que enseña Google no se pide por REST (no se puede poner
// junto a un mapa que no es suyo): lo pinta su elemento oficial, que ya trae
// la atribución. Aquí solo se decide cuándo y para qué sitio montarlo.
const CONTENIDO = [
  "gmp-place-rating",
  "gmp-place-open-now-status",
  "gmp-place-opening-hours",
  "gmp-place-reviews",
  "gmp-place-review-summary",
  "gmp-place-media",
  "gmp-place-website",
  "gmp-place-accessible-entrance-icon",
  "gmp-place-attribution",
];

let opcionesFijadas = false;

async function cargarBiblioteca(clave: string): Promise<void> {
  const { setOptions, importLibrary } = await import("@googlemaps/js-api-loader");
  // setOptions solo vale una vez por página; repetirlo avisa en consola.
  if (!opcionesFijadas) {
    setOptions({ key: clave, v: "weekly", language: "es" });
    opcionesFijadas = true;
  }
  await importLibrary("places");
}

function esNotFound(evento: Event): boolean {
  const error = (evento as Event & { error?: { code?: unknown; message?: unknown } }).error;
  return String(error?.code ?? error?.message ?? "").includes("NOT_FOUND");
}

export function FichaGoogle({ planId, paradaId, estado, abierto, hrefMaps, conFotos }: Props) {
  const [vista, setVista] = useState<Vista>({ tipo: "inactiva" });
  const [placeId, setPlaceId] = useState<string | null>(null);
  const iniciada = useRef(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const tieneClave = claveNavegador() !== null;

  async function marcarObsoleto() {
    try {
      await fetch("/api/google/ficha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, paradaId, obsoleto: true }),
      });
    } catch {
      // Sin red no hay nada que hacer; el trabajador ya revisa lo antiguo.
    }
  }

  async function cargar() {
    const clave = claveNavegador();
    const previo = mensajeSinPeticion(clave !== null, estado);
    if (previo || !clave) {
      setVista({ tipo: "mensaje", mensaje: previo ?? "sinClave" });
      return;
    }
    setVista({ tipo: "cargando" });
    try {
      const respuesta = await fetch("/api/google/ficha", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, paradaId }),
      });
      const resultado = interpretarRespuesta(respuesta.status, await respuesta.json().catch(() => null));
      if (resultado.tipo === "mensaje") {
        setVista(resultado);
        return;
      }
      await cargarBiblioteca(clave);
      setPlaceId(resultado.placeId);
    } catch {
      setVista({ tipo: "mensaje", mensaje: "errorGoogle" });
    }
  }

  // Primera apertura: una sola vez por panel y página. Cerrar y reabrir no
  // vuelve a pasar por aquí, así que no hay segunda reserva.
  useEffect(() => {
    if (!abierto || iniciada.current) return;
    iniciada.current = true;
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cargar lee props estables de la primera apertura
  }, [abierto]);

  // El elemento se crea una vez por place_id y se queda montado.
  useEffect(() => {
    const destino = contenedor.current;
    if (!placeId || !destino) return;
    const elemento = document.createElement("gmp-place-details");
    const peticion = document.createElement("gmp-place-details-place-request");
    peticion.setAttribute("place", placeId);
    const configuracion = document.createElement("gmp-place-content-config");
    for (const nombre of CONTENIDO) {
      if (nombre === "gmp-place-media" && !conFotos) continue;
      configuracion.appendChild(document.createElement(nombre));
    }
    elemento.append(peticion, configuracion);
    elemento.addEventListener("gmp-load", () => setVista({ tipo: "ficha" }));
    elemento.addEventListener("gmp-requesterror", (evento) => {
      if (esNotFound(evento)) void marcarObsoleto();
      setPlaceId(null);
      setVista({ tipo: "mensaje", mensaje: "errorGoogle" });
    });
    destino.appendChild(elemento);
    return () => elemento.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marcarObsoleto solo usa props estables
  }, [placeId]);

  function reintentar() {
    setPlaceId(null);
    void cargar();
  }

  return (
    <div className="ficha-google">
      {tieneClave && estado === "casado" && (
        <p className="ayuda">
          {TEXTOS_FICHA.privacidad.texto} <Link href="/privacidad">{TEXTOS_FICHA.privacidadEnlace.texto}</Link>
        </p>
      )}
      {vista.tipo === "cargando" && <p role="status">{TEXTOS_FICHA.cargando.texto}</p>}
      {vista.tipo === "mensaje" && (
        <>
          {vista.mensaje === "errorGoogle" ? (
            <p role="alert" className="mensaje-error">{TEXTO_MENSAJE_FICHA.errorGoogle}</p>
          ) : (
            <p className="ayuda">{TEXTO_MENSAJE_FICHA[vista.mensaje]}</p>
          )}
          {vista.mensaje === "errorGoogle" && (
            <button type="button" className="boton" onClick={reintentar}>{TEXTOS_FICHA.reintentar.texto}</button>
          )}
          <a href={hrefMaps} target="_blank" rel="noopener noreferrer">{TEXTOS_FICHA.abrirEnMaps.texto}</a>
        </>
      )}
      {/* El elemento de Google no pide nada mientras está oculto (ni dispara gmp-load): tiene que estar visible desde que se monta, con el aviso de carga al lado. */}
      <div ref={contenedor} hidden={placeId === null} />
    </div>
  );
}
