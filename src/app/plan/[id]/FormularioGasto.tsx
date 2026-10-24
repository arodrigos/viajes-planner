"use client";

import { useState } from "react";
import { importeACentimos, validarGasto, type ErroresGasto } from "@/lib/gastos/validar";
import { CATEGORIAS_GASTO, LONGITUD_CONCEPTO, type CategoriaGasto, type Gasto, type GastoEntrada } from "@/lib/gastos/tipos";
import { ERRORES_GASTO as E, TEXTOS_GASTOS as T } from "@/lib/textos/gastos";

interface Props {
  fechas: string[];
  diaInicial: string;
  inicial?: Gasto;
  onGuardar: (gasto: GastoEntrada, id?: string) => Promise<string | null>;
  onCancelar?: () => void;
}

const etiquetaDia = (fecha: string, i: number) => `${T.dia} ${i + 1} · ${fecha.slice(8)}/${fecha.slice(5, 7)}`;
const comoTexto = (centimos: number) => (centimos / 100).toFixed(2).replace(".", ",");

// Formulario rápido: importe con teclado numérico, categoría en 4 botones, día
// y concepto. Valida con la misma función que la ruta y la base; lo escrito no
// se pierde si el servidor falla (los valores viven aquí).
export function FormularioGasto({ fechas, diaInicial, inicial, onGuardar, onCancelar }: Props) {
  const [importe, setImporte] = useState(inicial ? comoTexto(inicial.importe_centimos) : "");
  const [categoria, setCategoria] = useState<CategoriaGasto>(inicial?.categoria ?? "comida");
  const [fecha, setFecha] = useState<string>(inicial ? (inicial.fecha ?? "") : diaInicial);
  const [concepto, setConcepto] = useState(inicial?.concepto ?? "");
  const [errores, setErrores] = useState<ErroresGasto>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Regla de los gastos grandes: alojamiento siempre a todo el viaje; transporte
  // elige día o todo el viaje; comida y entradas, siempre un día.
  const fechaEfectiva = categoria === "alojamiento" ? "" : categoria === "transporte" ? fecha : fecha || diaInicial;

  function elegirCategoria(nueva: CategoriaGasto) {
    setCategoria(nueva);
    if ((nueva === "comida" || nueva === "entradas") && fecha === "") setFecha(diaInicial);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErrorServidor(null);
    const centimos = importeACentimos(importe);
    const candidato = { importe_centimos: centimos ?? 0, fecha: fechaEfectiva === "" ? null : fechaEfectiva, categoria, concepto, actualizado_cliente: new Date().toISOString() };
    const r = validarGasto(candidato);
    if (centimos === null || !r.ok) {
      setErrores(!r.ok ? { ...r.errores, ...(centimos === null ? { importe_centimos: E.importe } : {}) } : { importe_centimos: E.importe });
      return;
    }
    setErrores({});
    setEnviando(true);
    const fallo = await onGuardar(r.gasto, inicial?.id);
    setEnviando(false);
    if (fallo) return setErrorServidor(fallo);
    if (!inicial) {
      setImporte("");
      setConcepto("");
    }
  }

  return (
    <form className="pila formulario-gasto" onSubmit={(e) => void enviar(e)} noValidate>
      <label>
        {T.importe}
        <input type="text" inputMode="decimal" autoComplete="off" value={importe} onChange={(e) => setImporte(e.target.value)} aria-invalid={errores.importe_centimos ? true : undefined} aria-describedby={errores.importe_centimos ? "error-importe-gasto" : undefined} />
      </label>
      {errores.importe_centimos && <p id="error-importe-gasto" role="alert" className="error-campo">{errores.importe_centimos}</p>}
      <div role="group" aria-label={T.categoria} className="fila categorias-gasto">
        {CATEGORIAS_GASTO.map((c) => (
          <button key={c} type="button" className="boton" aria-pressed={categoria === c} onClick={() => elegirCategoria(c)}>
            {T.categorias[c]}
          </button>
        ))}
      </div>
      {errores.categoria && <p role="alert" className="error-campo">{errores.categoria}</p>}
      <label>
        {T.dia}
        <select value={fechaEfectiva} disabled={categoria === "alojamiento"} onChange={(e) => setFecha(e.target.value)}>
          {categoria !== "comida" && categoria !== "entradas" && <option value="">{T.todoElViaje}</option>}
          {fechas.map((f, i) => (
            <option key={f} value={f}>{etiquetaDia(f, i)}</option>
          ))}
        </select>
      </label>
      {categoria === "alojamiento" && <p className="ayuda">{T.ayudaAlojamiento}</p>}
      {errores.fecha && <p role="alert" className="error-campo">{errores.fecha}</p>}
      <label>
        {T.concepto}
        <input type="text" maxLength={LONGITUD_CONCEPTO} value={concepto} onChange={(e) => setConcepto(e.target.value)} data-sensible />
      </label>
      {errores.concepto && <p role="alert" className="error-campo">{errores.concepto}</p>}
      {errorServidor && <p role="alert" className="error-campo">{errorServidor}</p>}
      <div className="fila">
        <button type="submit" className="boton" disabled={enviando}>{inicial ? T.guardar : T.apuntar}</button>
        {onCancelar && <button type="button" onClick={onCancelar}>{T.cancelar}</button>}
      </div>
    </form>
  );
}
