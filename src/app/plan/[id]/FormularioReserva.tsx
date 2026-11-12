"use client";

import { useState } from "react";
import { LIMITES, validarReserva, type ErroresReserva } from "@/lib/reservas/validar";
import { interpretarUbicacion } from "@/lib/reservas/ubicacion";
import { TIPOS_RESERVA, type Reserva, type ReservaEntrada, type TipoReserva } from "@/lib/reservas/tipos";
import type { BorradorImportado } from "@/lib/reservas/importar/tipos";
import { TEXTOS_IMPORTAR as TI, TEXTOS_RESERVAS as T } from "@/lib/textos/reservas";

interface Props {
  planId: string;
  fechas: string[];
  inicial?: Reserva;
  // Reserva precargada desde un .ics: nada se guarda hasta pulsar «Guardar».
  borrador?: BorradorImportado;
  onGuardada: (reserva: Reserva) => void;
  onCancelar: () => void;
}

type Valores = Record<string, string>;

const CAMPOS = ["sentido", "fecha_inicio", "hora_inicio", "fecha_fin", "hora_fin", "origen", "destino", "nombre", "direccion", "localizador", "notas"] as const;

// Con borrador el trayecto no se inventa: queda vacío y marcado como «Falta».
function valoresDe(r?: Reserva | Partial<ReservaEntrada>): Valores {
  const v: Valores = { tipo: r?.tipo ?? "vuelo" };
  for (const c of CAMPOS) v[c] = (r?.[c] as string | undefined) ?? (c === "sentido" && !r ? "ida" : "");
  return v;
}

// Marca con texto (no solo color) lo que el .ics no trajo y lo que se dedujo.
function Marca({ tipo }: { tipo: "falta" | "sugerido" | null }) {
  if (!tipo) return null;
  return <span className="marca-aviso" data-testid={`marca-${tipo}`}>{tipo === "falta" ? TI.falta : TI.sugerido}</span>;
}

// Formulario cerrado por tipo: solo se enseñan los campos de ese tipo. Valida
// con la misma función que la ruta y la base, y lo escrito no se pierde si algo
// falla (los valores viven aquí, no en la respuesta).
function CampoReserva({ campo, etiqueta, tipoInput = "text", tope, valor, onChange, error, deshabilitado, min, max, marca = null }: {
  campo: string;
  etiqueta: string;
  tipoInput?: string;
  tope?: number;
  valor: string;
  onChange: (e: { target: { value: string } }) => void;
  error?: string;
  deshabilitado: boolean;
  min?: string;
  max?: string;
  marca?: "falta" | "sugerido" | null;
}) {
  const id = `reserva-${campo}`;
  const esFecha = tipoInput === "date";
  return (
    <div className={marca ? "pila campo-aviso" : "pila"}>
      <label htmlFor={id}>{etiqueta}</label>
      <Marca tipo={marca} />
      <input
        id={id}
        type={tipoInput}
        value={valor}
        onChange={onChange}
        min={esFecha ? min : undefined}
        max={esFecha ? max : undefined}
        autoComplete="off"
        data-sensible
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={deshabilitado}
      />
      {tope !== undefined && <span className="ayuda">{T.contador([...valor].length, tope)}</span>}
      {error && (
        <p role="alert" id={`${id}-error`} className="mensaje-error">
          {error}
        </p>
      )}
    </div>
  );
}

function LineaZona({ texto, zona, marca }: { texto: (zona: string) => string; zona?: string; marca: "falta" | "sugerido" | null }) {
  return (
    <p className="ayuda" data-testid="zona-reserva">
      {zona ? texto(zona) : TI.sinZona} <Marca tipo={marca} />
    </p>
  );
}

export function FormularioReserva({ planId, fechas, inicial, borrador, onGuardada, onCancelar }: Props) {
  const [v, setV] = useState<Valores>(() => valoresDe(inicial ?? borrador?.reserva));
  const [inicioV] = useState<Valores>(v);
  const zonas = { inicio: borrador?.reserva.zona_inicio, fin: borrador?.reserva.zona_fin };
  const [ubicacion, setUbicacion] = useState<{ lat: number; lon: number } | null>(inicial?.ubicacion ?? borrador?.reserva.ubicacion ?? null);
  const [pegado, setPegado] = useState("");
  const [errorUbicacion, setErrorUbicacion] = useState<string | null>(null);
  const [errores, setErrores] = useState<ErroresReserva>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const tipo = v.tipo as TipoReserva;
  const transporte = tipo === "vuelo" || tipo === "tren";
  const min = fechas[0];
  const max = fechas[fechas.length - 1];
  // Un hueco se marca mientras el campo siga vacío; lo deducido, mientras la
  // persona no lo haya cambiado.
  const marcaDe = (campo: string): "falta" | "sugerido" | null => {
    if (!borrador || tipo !== borrador.tipoSugerido && campo !== "tipo") return null;
    if ((borrador.huecos as string[]).includes(campo) && v[campo] === "") return "falta";
    if ((borrador.deducidos as string[]).includes(campo) && v[campo] === inicioV[campo]) return "sugerido";
    return null;
  };
  const poner = (campo: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [campo]: e.target.value }));

  function entrada(): unknown {
    const e: Record<string, unknown> = { tipo };
    for (const c of CAMPOS) if (v[c] !== "") e[c] = v[c];
    if (!transporte) delete e.sentido;
    if (tipo === "hotel") delete e.hora_fin;
    if (tipo === "hotel" && ubicacion) e.ubicacion = ubicacion;
    // Las zonas del .ics solo aplican a los transportes y se conservan tal cual
    // (la ruta las valida como las de un alta manual).
    if (transporte && borrador && tipo === borrador.tipoSugerido) {
      if (zonas.inicio) e.zona_inicio = zonas.inicio;
      if (zonas.fin) e.zona_fin = zonas.fin;
    }
    return e;
  }

  function usarMiUbicacion() {
    setErrorUbicacion(null);
    if (!("geolocation" in navigator)) return setErrorUbicacion(T.ubicacionSinPermiso);
    navigator.geolocation.getCurrentPosition(
      (p) => setUbicacion({ lat: Number(p.coords.latitude.toFixed(5)), lon: Number(p.coords.longitude.toFixed(5)) }),
      () => setErrorUbicacion(T.ubicacionSinPermiso),
      { timeout: 10000 },
    );
  }

  function pegar(texto: string) {
    setPegado(texto);
    if (texto.trim() === "") return setErrorUbicacion(null);
    const c = interpretarUbicacion(texto);
    if (c) {
      setUbicacion(c);
      setErrorUbicacion(null);
    } else setErrorUbicacion(T.ubicacionNoValida);
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (guardando) return;
    setErrorGeneral(null);
    const local = validarReserva(entrada(), { viaje: min && max ? { desde: min, hasta: max } : undefined });
    if (!local.ok) return setErrores(local.errores);
    setErrores({});
    setGuardando(true);
    try {
      const r = await fetch(inicial ? `/api/plan/${planId}/reservas/${inicial.id}` : `/api/plan/${planId}/reservas`, {
        method: inicial ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(local.reserva as ReservaEntrada),
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) {
        if (datos?.errores && typeof datos.errores === "object") setErrores(datos.errores);
        setErrorGeneral(typeof datos?.error === "string" ? datos.error : T.errorGuardar);
        return;
      }
      onGuardada(datos as Reserva);
    } catch {
      setErrorGeneral(T.errorGuardar);
    } finally {
      setGuardando(false);
    }
  }

  const Campo = (p: { campo: string; etiqueta: string; tipoInput?: string; tope?: number }) => (
    <CampoReserva {...p} valor={v[p.campo]} onChange={poner(p.campo)} error={errores[p.campo as keyof ErroresReserva]} deshabilitado={guardando} min={min} max={max} marca={marcaDe(p.campo)} />
  );
  // noValidate: los errores los explica la propia función de validación, en su campo.
  return (
    <form className="pila" onSubmit={(e) => void guardar(e)} noValidate aria-label={inicial ? T.editar : T.apuntar}>
      {borrador && <p className="aviso-importar" data-testid="rellenado-desde-archivo">{TI.rellenado}</p>}
      <div className={marcaDe("tipo") ? "pila campo-aviso" : "pila"}>
      <label htmlFor="reserva-tipo">{T.tipo}</label>
      <Marca tipo={marcaDe("tipo")} />
      <select id="reserva-tipo" value={tipo} onChange={poner("tipo")} disabled={guardando || inicial !== undefined}>
        {TIPOS_RESERVA.map((t) => (
          <option key={t} value={t}>
            {T.tipos[t]}
          </option>
        ))}
      </select>
      </div>
      {errores.tipo && <p role="alert" className="mensaje-error">{errores.tipo}</p>}

      {transporte && (
        <>
          <div className={marcaDe("sentido") ? "pila campo-aviso" : "pila"}>
          <label htmlFor="reserva-sentido">{T.sentido}</label>
          <Marca tipo={marcaDe("sentido")} />
          <select id="reserva-sentido" value={v.sentido} onChange={poner("sentido")} disabled={guardando}>
            {v.sentido === "" && <option value="">{TI.elige}</option>}
            <option value="ida">{T.sentidos.ida}</option>
            <option value="vuelta">{T.sentidos.vuelta}</option>
          </select>
          </div>
          {errores.sentido && <p role="alert" className="mensaje-error">{errores.sentido}</p>}
          {Campo({ campo: "origen", etiqueta: T.origen, tope: LIMITES.origen })}
          {Campo({ campo: "destino", etiqueta: T.destino, tope: LIMITES.destino })}
          {Campo({ campo: "fecha_inicio", etiqueta: T.salidaDia, tipoInput: "date" })}
          {Campo({ campo: "hora_inicio", etiqueta: T.salidaHora, tipoInput: "time" })}
          {borrador && tipo === borrador.tipoSugerido && <LineaZona texto={TI.zonaSalida} zona={zonas.inicio} marca={marcaDe("zona_inicio")} />}
          {Campo({ campo: "fecha_fin", etiqueta: T.llegadaDia, tipoInput: "date" })}
          {Campo({ campo: "hora_fin", etiqueta: T.llegadaHora, tipoInput: "time" })}
          {borrador && tipo === borrador.tipoSugerido && <LineaZona texto={TI.zonaLlegada} zona={zonas.fin} marca={marcaDe("zona_fin")} />}
        </>
      )}
      {tipo === "hotel" && (
        <>
          {Campo({ campo: "nombre", etiqueta: T.nombreHotel, tope: LIMITES.nombre })}
          {Campo({ campo: "fecha_inicio", etiqueta: T.entradaDia, tipoInput: "date" })}
          {Campo({ campo: "fecha_fin", etiqueta: T.salidaHotelDia, tipoInput: "date" })}
          {Campo({ campo: "direccion", etiqueta: T.direccion, tope: LIMITES.direccion })}
          <div className="pila" role="group" aria-label={T.ubicacion}>
            <strong>{T.ubicacion}</strong>
            <p className="ayuda">{T.ubicacionAyuda}</p>
            {ubicacion ? (
              <p>
                <span data-sensible>{T.ubicacionOk}</span>{" "}
                <button type="button" onClick={() => { setUbicacion(null); setPegado(""); }}>{T.quitarUbicacion}</button>
              </p>
            ) : (
              <>
                <button type="button" onClick={usarMiUbicacion} disabled={guardando}>{T.usarMiUbicacion}</button>
                <label htmlFor="reserva-ubicacion-pegada">{T.ubicacionPegar}</label>
                <input id="reserva-ubicacion-pegada" type="text" value={pegado} onChange={(e) => pegar(e.target.value)} autoComplete="off" data-sensible />
              </>
            )}
            {errorUbicacion && <p role="alert" className="mensaje-error">{errorUbicacion}</p>}
            {errores.ubicacion && <p role="alert" className="mensaje-error">{errores.ubicacion}</p>}
          </div>
        </>
      )}
      {tipo === "entrada" && (
        <>
          {Campo({ campo: "nombre", etiqueta: T.nombreEntrada, tope: LIMITES.nombre })}
          {Campo({ campo: "fecha_inicio", etiqueta: T.dia, tipoInput: "date" })}
          {Campo({ campo: "hora_inicio", etiqueta: T.hora, tipoInput: "time" })}
          {Campo({ campo: "hora_fin", etiqueta: T.horaFin, tipoInput: "time" })}
        </>
      )}
      {Campo({ campo: "localizador", etiqueta: T.localizador, tope: LIMITES.localizador })}
      {Campo({ campo: "notas", etiqueta: T.notas, tope: LIMITES.notas })}

      {errorGeneral && <p role="alert" className="mensaje-error">{errorGeneral}</p>}
      <div className="fila">
        <button type="button" onClick={onCancelar} disabled={guardando}>{T.cancelar}</button>
        <button type="submit" className="boton" disabled={guardando}>{guardando ? T.guardando : T.guardar}</button>
      </div>
    </form>
  );
}
