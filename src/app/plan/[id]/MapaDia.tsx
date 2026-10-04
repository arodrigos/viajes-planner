"use client";

// map-ac1..ac5: mapa interactivo del día sobre OpenFreeMap (teselas
// vectoriales de OpenStreetMap, sin cuenta ni clave). Componente cliente
// puro: VistaPlan.tsx lo carga con next/dynamic y ssr:false porque
// maplibre-gl exige `window` y no se puede renderizar en servidor (guía
// SSR de @vis.gl/react-maplibre).
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import { useMemo, useState } from "react";
import { AttributionControl, Layer, Map, Marker, Source } from "@vis.gl/react-maplibre";

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
}

function calcularBounds(puntos: PuntoMapaDia[]): [[number, number], [number, number]] {
  const lons = puntos.map((p) => p.lon);
  const lats = puntos.map((p) => p.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function MapaDia({ puntos, paradaActivaId, onSeleccionarParada }: PropiedadesMapaDia) {
  const [fallo, setFallo] = useState(false);

  const puntosOrdenados = useMemo(() => [...puntos].sort((a, b) => a.orden - b.orden), [puntos]);

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

  if (fallo) {
    // map-ac5: el fallo del mapa no esconde la lista de paradas ni los
    // enlaces a Google Maps -ambos viven fuera de este componente, en
    // VistaPlan.tsx.
    return <p className="mapa-no-disponible">El mapa no está disponible ahora.</p>;
  }

  return (
    <div className="contenedor-mapa-dia" data-recorrido-puntos={puntosOrdenados.length}>
      <Map
        initialViewState={{
          bounds: calcularBounds(puntosOrdenados),
          fitBoundsOptions: { padding: 40 },
        }}
        mapStyle={ESTILO_OPENFREEMAP}
        attributionControl={false}
        style={{ width: "100%", height: "280px" }}
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
