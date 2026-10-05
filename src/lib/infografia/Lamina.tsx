// inf-ac2: JSX para satori (next/og): solo flexbox y estilos en línea, y todo
// contenedor con varios hijos lleva display:flex. Sin mapa base ni imágenes de
// terceros: la ruta son puntos y líneas dibujados aquí.
import type { ModeloInfografia } from "./modelo";
import { proyectarRuta, type PuntoPlano } from "./proyeccion";

export const ANCHO_LAMINA = 1080;
export const ALTO_LAMINA = 1350;

const COLOR = { fondo: "#f6f1e7", tinta: "#1d2b36", suave: "#5a6b78", acento: "#0f766e", linea: "#c9bfa9" };
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

export function Lamina({ modelo }: { modelo: ModeloInfografia }) {
  const puntos = modelo.bloques.flatMap((b) => (b.punto ? [b.punto] : []));
  const plano = modelo.multiciudad && puntos.length > 0 ? proyectarRuta(puntos, RECUADRO) : [];
  const nombres = modelo.bloques.filter((b) => b.punto).map((b) => b.titulo);
  const t = modelo.totales;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: ANCHO_LAMINA, height: ALTO_LAMINA, padding: 60, background: COLOR.fondo, color: COLOR.tinta }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.1 }}>{modelo.titulo.slice(0, 40)}</div>
        <div style={{ display: "flex", fontSize: 34, color: COLOR.suave, marginTop: 10 }}>{modelo.subtitulo}</div>
      </div>

      {plano.length > 0 && (
        <div style={{ display: "flex", position: "relative", marginTop: 24, border: `2px solid ${COLOR.linea}`, borderRadius: 24, width: RECUADRO.ancho, height: RECUADRO.alto }}>
          <Ruta puntos={plano} />
          {plano.map((p, i) => (
            <div key={i} style={{ display: "flex", position: "absolute", left: Math.min(p.x + 22, RECUADRO.ancho - 190), top: p.y - 16, fontSize: 28, color: COLOR.tinta }}>
              {(nombres[i] ?? "").slice(0, 14)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", marginTop: 24, flexGrow: 1 }}>
        {modelo.bloques.map((b, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <div style={{ display: "flex", fontSize: 44, color: COLOR.acento }}>{b.titulo.slice(0, 30)}</div>
              {b.detalle && <div style={{ display: "flex", fontSize: 30, color: COLOR.suave, marginLeft: 20 }}>{b.detalle}</div>}
            </div>
            {b.paradas.map((p, j) => (
              <div key={j} style={{ display: "flex", fontSize: 30, marginTop: 4 }}>{`• ${p.slice(0, 48)}`}</div>
            ))}
          </div>
        ))}
        {modelo.eventos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
            <div style={{ display: "flex", fontSize: 32, color: COLOR.acento }}>Eventos</div>
            {modelo.eventos.map((e, i) => (
              <div key={i} style={{ display: "flex", fontSize: 26, color: COLOR.suave, marginTop: 2 }}>{e.slice(0, 60)}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", borderTop: `3px solid ${COLOR.linea}`, paddingTop: 20 }}>
        <div style={{ display: "flex", fontSize: 34 }}>{`${t.dias} días · ${t.sitios} sitios${t.km_traslado > 0 ? ` · ${t.km_traslado} km de traslado` : ""}`}</div>
        <div style={{ display: "flex", fontSize: 40, color: COLOR.acento, marginTop: 8 }}>{`Presupuesto estimado: ${t.texto_presupuesto}`}</div>
      </div>
    </div>
  );
}
