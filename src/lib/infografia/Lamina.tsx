// inf-ac2: JSX para satori (next/og): solo flexbox y estilos en línea, y todo
// contenedor con varios hijos lleva display:flex. Sin mapa base ni imágenes de
// terceros: la ruta son puntos y líneas dibujados aquí.
import type { ModeloInfografia } from "./modelo";
import { recortar } from "./texto";
import { proyectarRuta, type PuntoPlano } from "./proyeccion";

// Tamaño de letra del título: el medidor lo usa para fijar su tolerancia de huecos.
export const TAM_TITULO = 58;
export const ANCHO_LAMINA = 1080;
export const ALTO_LAMINA = 1350;

export const COLOR = { fondo: "#f6f1e7", tinta: "#1d2b36", suave: "#5a6b78", acento: "#0f766e", linea: "#c9bfa9" };
const RECUADRO = { ancho: 960, alto: 300, margen: 40 };

function Ruta({ puntos }: { puntos: PuntoPlano[] }) {
  return (
    <svg width={RECUADRO.ancho} height={RECUADRO.alto} viewBox={`0 0 ${RECUADRO.ancho} ${RECUADRO.alto}`}>
      {puntos.slice(1).map((p, i) => (
        <line key={`l${i}`} x1={puntos[i].x} y1={puntos[i].y} x2={p.x} y2={p.y} stroke={COLOR.acento} strokeWidth={5} strokeLinecap="round" />
      ))}
      {puntos.map((p, i) => (
        <circle key={`c${i}`} cx={p.x} cy={p.y} r={14} fill={COLOR.acento} stroke={COLOR.fondo} strokeWidth={4} />
      ))}
    </svg>
  );
}

// lam-ac3: una fila por bloque (título a la izquierda, paradas a la derecha) y
// no un bloque apilado: es lo que deja caber 7 días + 4 eventos + un título de
// dos líneas en 1350 px. Todo texto de una línea lleva respaldo de ellipsis
// por anchura, por si el recorte por grafemas del modelo se queda corto con
// letras anchas.
const UNA_LINEA = { display: "flex", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" } as const;

export function Lamina({ modelo }: { modelo: ModeloInfografia }) {
  const puntos = modelo.bloques.flatMap((b) => (b.punto ? [b.punto] : []));
  const plano = modelo.multiciudad && puntos.length > 0 ? proyectarRuta(puntos, RECUADRO) : [];
  const nombres = modelo.bloques.filter((b) => b.punto).map((b) => b.titulo);
  const t = modelo.totales;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: ANCHO_LAMINA, height: ALTO_LAMINA, padding: 60, background: COLOR.fondo, color: COLOR.tinta, fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: TAM_TITULO, fontWeight: 700, lineHeight: 1.1, lineClamp: 2 }}>{modelo.titulo}</div>
        <div style={{ ...UNA_LINEA, fontSize: 32, color: COLOR.suave, marginTop: 10 }}>{modelo.subtitulo}</div>
      </div>

      {plano.length > 0 && (
        <div style={{ display: "flex", position: "relative", marginTop: 24, border: `2px solid ${COLOR.linea}`, borderRadius: 24, width: RECUADRO.ancho, height: RECUADRO.alto }}>
          <Ruta puntos={plano} />
          {plano.map((p, i) => (
            <div key={i} style={{ display: "flex", position: "absolute", left: Math.min(p.x + 22, RECUADRO.ancho - 190), top: p.y - 16, fontSize: 28, color: COLOR.tinta }}>
              {recortar(nombres[i] ?? "", 14)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", marginTop: 24, flexGrow: 1 }}>
        {modelo.bloques.map((b, i) => (
          <div key={i} style={{ display: "flex", marginBottom: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", width: 300, flexShrink: 0, marginRight: 20 }}>
              <div style={{ ...UNA_LINEA, fontSize: 36, fontWeight: 700, color: COLOR.acento }}>{b.titulo}</div>
              {b.detalle && <div style={{ ...UNA_LINEA, fontSize: 24, color: COLOR.suave }}>{b.detalle}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
              {b.paradas.map((p, j) => (
                <div key={j} style={{ ...UNA_LINEA, fontSize: 26, lineHeight: 1.25 }}>{`• ${p}`}</div>
              ))}
            </div>
          </div>
        ))}
        {modelo.resto && <div style={{ display: "flex", fontSize: 28, color: COLOR.suave }}>{modelo.resto}</div>}
        {modelo.eventos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.acento }}>Eventos</div>
            {modelo.eventos.map((e, i) => (
              <div key={i} style={{ ...UNA_LINEA, fontSize: 24, color: COLOR.suave, marginTop: 2 }}>{e}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", borderTop: `3px solid ${COLOR.linea}`, paddingTop: 20 }}>
        <div style={{ display: "flex", fontSize: 34 }}>{`${t.dias} días · ${t.sitios} sitios${t.km_traslado > 0 ? ` · ${t.km_traslado} km de traslado` : ""}`}</div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: COLOR.acento, marginTop: 8 }}>{`Presupuesto estimado: ${t.texto_presupuesto}`}</div>
      </div>
    </div>
  );
}
