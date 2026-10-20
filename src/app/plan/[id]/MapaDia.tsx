"use client";

// map-ac1..ac5: mapa interactivo del día sobre OpenFreeMap (teselas
// vectoriales de OpenStreetMap, sin cuenta ni clave). Componente cliente
// puro: VistaPlan.tsx lo carga con next/dynamic y ssr:false porque
// maplibre-gl exige `window` y no se puede renderizar en servidor (guía
// SSR de @vis.gl/react-maplibre).
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, Layer, Map, Marker, Source } from "@vis.gl/react-maplibre";
import type { MapRef } from "@vis.gl/react-maplibre";
import { diaEstaGuardado } from "@/lib/sinConexion/mapas";

const ESTILO_OPENFREEMAP = "https://tiles.openfreemap.org/styles/liberty";

// Excepción de Next.js que el propio proyecto MapLibre documenta: Turbopack
// (y `next build --webpack`) no emite maplibre-gl-shared.mjs junto al
// worker con `new URL(...)`, así que el worker falla en su primer import y
// el mapa monta pero nunca pide una tesela. scripts/copiar-worker-maplibre.mjs
// copia ambos ficheros a public/ en cada `npm install`; aquí solo se
// apunta a esa ruta estática, una sola vez por carga del módulo.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export interface PuntoMapaDia {
  id: string;
  orden: number;
  nombre: string;
  lat: number;
  lon: number;
}

interface PropiedadesMapaDia {
  puntos: PuntoMapaDia[];
  paradaActivaId?: string | null;
  onSeleccionarParada?: (id: string) => void;
  // dest-ac2: ids de paradas visitadas (marcador con data-estado="visitada")
  // y la parada en la que recentrar el mapa -la siguiente sin visitar-,
  // ambos opcionales porque fuera de la vista del día de hoy no se calculan.
  idsVisitados?: Set<string>;
  centroParadaId?: string | null;
  // etv-ac2: en un viaje de varias ciudades, la caja de la etapa del día; sin
  // paradas resueltas el mapa se centra en ella y no en el país entero.
  cajaEtapa?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  // vista-por-dias: compacto por defecto en el panel del día, ampliable.
  alto?: number;
}

function calcularBounds(puntos: PuntoMapaDia[]): [[number, number], [number, number]] {
  const lons = puntos.map((p) => p.lon);
  const lats = puntos.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function MapaDia({ puntos, paradaActivaId, onSeleccionarParada, idsVisitados, centroParadaId, cajaEtapa, alto = 280 }: PropiedadesMapaDia) {
  const [fallo, setFallo] = useState(false);
  // Sin red, el estilo de OpenFreeMap no llega y MapLibre no siempre emite
  // error a tiempo (el día que se carga con la página ya sin conexión se
  // quedaba el hueco): el aviso sale por el estado del navegador, y se
  // retira solo al volver la conexión.
  const [sinRed, setSinRed] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const alCambiar = () => setSinRed(!navigator.onLine);
    window.addEventListener("online", alCambiar);
    window.addEventListener("offline", alCambiar);
    alCambiar();
    return () => {
      window.removeEventListener("online", alCambiar);
      window.removeEventListener("offline", alCambiar);
    };
  }, []);
  const mapaRef = useRef<MapRef>(null);

  const puntosOrdenados = useMemo(() => [...puntos].sort((a, b) => a.orden - b.orden), [puntos]);

  // Sin red solo hay mapa si el día se guardó: se comprueba contra la caché
  // real y no contra una marca, porque el sistema puede haberla expulsado.
  // La clave evita repetir la comprobación cuando el padre pasa un array nuevo
  // con los mismos puntos.
  const clavePuntos = puntos.map((p) => `${p.lat},${p.lon}`).join(";");
  const [comprobado, setComprobado] = useState<{ clave: string; guardado: boolean } | null>(null);
  const guardado = comprobado?.clave === clavePuntos ? comprobado.guardado : null;
  useEffect(() => {
    if (!sinRed) return;
    let vivo = true;
    void diaEstaGuardado(clavePuntos === "" ? [] : clavePuntos.split(";").map((c) => ({ lat: Number(c.split(",")[0]), lon: Number(c.split(",")[1]) }))).then((g) => {
      if (vivo) setComprobado({ clave: clavePuntos, guardado: g });
    });
    return () => {
      vivo = false;
    };
  }, [sinRed, clavePuntos]);

  // dest-ac2: recentra sobre la siguiente parada sin visitar cuando cambia,
  // sin perder el encuadre inicial de fitBounds si no hay ninguna (plan
  // recién cargado, o día con todas las paradas visitadas).
  useEffect(() => {
    if (!centroParadaId) return;
    const punto = puntosOrdenados.find((p) => p.id === centroParadaId);
    if (punto) mapaRef.current?.easeTo({ center: [punto.lon, punto.lat] });
  }, [centroParadaId, puntosOrdenados]);

  const geojsonRecorrido = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: puntosOrdenados.map((p) => [p.lon, p.lat]),
      },
    }),
    [puntosOrdenados],
  );

  // map-ac5: el fallo del mapa no esconde la lista de paradas ni los
  // enlaces a Google Maps -ambos viven fuera de este componente, en
  // VistaPlan.tsx.
  if (fallo) return <p className="mapa-no-disponible">El mapa no está disponible ahora.</p>;
  if (sinRed && guardado === null) return <p role="status" className="mapa-comprobando">Comprobando el mapa guardado…</p>;
  if (sinRed && !guardado) {
    return <p className="mapa-no-guardado">Este día no está guardado para usar sin red. Con conexión, pulsa «Guardar mapas para usar sin red».</p>;
  }

  const bounds: [[number, number], [number, number]] = puntosOrdenados.length > 0
    ? calcularBounds(puntosOrdenados)
    : cajaEtapa
      ? [[cajaEtapa.minLon, cajaEtapa.minLat], [cajaEtapa.maxLon, cajaEtapa.maxLat]]
      : [[-180, -85], [180, 85]];

  return (
    <div
      className="contenedor-mapa-dia"
      data-centro={`${(bounds[0][1] + bounds[1][1]) / 2},${(bounds[0][0] + bounds[1][0]) / 2}`}
      data-recorrido-puntos={puntosOrdenados.length}
      data-centro-parada={centroParadaId ?? undefined}
    >
      <Map
        ref={mapaRef}
        initialViewState={{
          bounds,
          fitBoundsOptions: { padding: 40 },
        }}
        mapStyle={ESTILO_OPENFREEMAP}
        attributionControl={false}
        style={{ width: "100%", height: `${alto}px` }}
        onError={() => setFallo(true)}
      >
        {/* map-ac4: atribución visible, nunca colapsada en móvil -requisito
            de licencia (ODbL + estilo de OpenFreeMap), no estética. */}
        <AttributionControl compact={false} />
        <Source id="recorrido" type="geojson" data={geojsonRecorrido}>
          <Layer
            id="recorrido-linea"
            type="line"
            paint={{ "line-color": "#2563eb", "line-width": 3, "line-opacity": 0.8 }}
          />
        </Source>
        {puntosOrdenados.map((punto) => (
          <Marker key={punto.id} longitude={punto.lon} latitude={punto.lat} anchor="bottom">
            <button
              type="button"
              className="marcador-parada"
              data-orden={punto.orden}
              data-parada-id={punto.id}
              data-estado={idsVisitados?.has(punto.id) ? "visitada" : "pendiente"}
              aria-label={`${punto.orden}. ${punto.nombre}`}
              aria-pressed={paradaActivaId === punto.id}
              onClick={() => onSeleccionarParada?.(punto.id)}
            >
              {punto.orden}
            </button>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
