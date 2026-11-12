"use client";

import { useRef, useState } from "react";
import { IconoFileUp } from "@/lib/iconos/lucide";
import { etiquetaMomento } from "@/lib/reservas/importar/describir";
import { comprobarFichero, leerIcs } from "@/lib/reservas/importar/leerIcs";
import type { EventoIcs, MotivoFallo } from "@/lib/reservas/importar/tipos";
import { sugerirTipo } from "@/lib/reservas/importar/aBorrador";
import { limpiarTexto } from "@/lib/reservas/validar";
import { TEXTOS_IMPORTAR as TI } from "@/lib/textos/reservas";

// Botón de importar con su ayuda y su aviso de privacidad. El fichero se lee
// aquí, en el navegador: no hay fetch y su contenido no se guarda en ningún
// sitio; solo los eventos normalizados suben al padre.
export function BotonImportar({ deshabilitado, onEventos }: { deshabilitado: boolean; onEventos: (eventos: EventoIcs[]) => void }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [fallo, setFallo] = useState<MotivoFallo | null>(null);

  async function elegido(e: React.ChangeEvent<HTMLInputElement>) {
    const fichero = e.target.files?.[0];
    // Permite volver a elegir el mismo archivo tras un error o una cancelación.
    e.target.value = "";
    if (!fichero) return;
    setFallo(null);
    const grande = comprobarFichero(fichero);
    if (grande) return setFallo(grande);
    setLeyendo(true);
    try {
      const r = await leerIcs(await fichero.text());
      if (r.ok) onEventos(r.eventos);
      else setFallo(r.motivo);
    } catch {
      setFallo("malformado");
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="pila">
      <button type="button" className="boton boton-importar" disabled={deshabilitado || leyendo} onClick={() => entrada.current?.click()}>
        <IconoFileUp />
        {leyendo ? TI.leyendo : TI.boton}
      </button>
      {/* Fuera del flujo de teclado: el botón de arriba es el que se alcanza con Tab y abre este selector. */}
      <input ref={entrada} type="file" accept=".ics,text/calendar" hidden tabIndex={-1} onChange={(e) => void elegido(e)} data-testid="importar-archivo" />
      <p className="ayuda">{TI.ayudaIphone}</p>
      <p className="ayuda">{TI.privacidad}</p>
      {fallo && <p role="alert" className="mensaje-error" data-testid="importar-error">{TI.errores[fallo]}</p>}
    </div>
  );
}

// Lista de elegir cuando el archivo trae varias reservas. El título del .ics
// es texto ajeno: se limpia y se pinta como texto de React, nunca como HTML.
export function ListaEventos({ eventos, hechos, fechas, onUsar, onCancelar }: { eventos: EventoIcs[]; hechos: ReadonlySet<number>; fechas: string[]; onUsar: (e: EventoIcs) => void; onCancelar: () => void }) {
  return (
    <section className="pila" aria-label={TI.tituloLista(eventos.length)}>
      <h3>{TI.tituloLista(eventos.length)}</h3>
      <ul className="pila">
        {eventos.map((e) => {
          const fuera = fechas.length > 0 && (e.inicio.fecha < fechas[0] || e.inicio.fecha > fechas[fechas.length - 1]);
          return (
            <li key={e.indice} className="tarjeta-evento-ics pila" data-testid="evento-ics">
              <strong>{etiquetaMomento(e.inicio)}</strong>
              <span data-sensible>{limpiarTexto(e.titulo).slice(0, 120) || TI.sinTitulo}</span>
              <span className="ayuda">{TI.parece[sugerirTipo(e)]}</span>
              {fuera && <p className="mensaje-error">{TI.fueraDelViaje}</p>}
              <button type="button" className="boton" disabled={hechos.has(e.indice)} onClick={() => onUsar(e)}>{TI.usarEsta}</button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onCancelar}>Cancelar</button>
    </section>
  );
}
