"use client";

import { useEffect, useState } from "react";
import { guardarBorrador, leerBorrador } from "@/lib/criterios/borrador";
import { validarCriterios } from "@/lib/criterios/validar";
import type { CriteriosViaje, Perfil } from "@/lib/criterios/tipos";

const CRITERIOS_INICIALES: CriteriosViaje = {
  destino_o_tipo: "",
  fechas: { modo: "epoca", epoca: "" },
  dias: 5,
  personas: [{ edad: 30 }],
  perfil: "familiar",
  presupuesto_eur: 1000,
  alojamiento: undefined,
};

export function FormularioCriterios() {
  const [criterios, setCriterios] = useState<CriteriosViaje>(CRITERIOS_INICIALES);
  const [conAlojamiento, setConAlojamiento] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    // localStorage no existe en el servidor: hidratar el borrador tiene que
    // esperar a este efecto aunque dispare un segundo render, no hay forma
    // de leerlo durante el render inicial sin desincronizar SSR e hidratación.
    const borrador = leerBorrador();
    if (borrador) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación desde localStorage, no sincronización derivada de props/estado
      setCriterios(borrador);
      setConAlojamiento(Boolean(borrador.alojamiento));
    }
    setCargado(true);
  }, []);

  useEffect(() => {
    if (cargado) guardarBorrador(criterios);
  }, [criterios, cargado]);

  function actualizarPersona(indice: number, edad: number) {
    setCriterios((c) => ({
      ...c,
      personas: c.personas.map((p, i) => (i === indice ? { edad } : p)),
    }));
  }

  function añadirPersona() {
    setCriterios((c) => ({ ...c, personas: [...c.personas, { edad: 18 }] }));
  }

  function quitarPersona(indice: number) {
    setCriterios((c) => ({ ...c, personas: c.personas.filter((_, i) => i !== indice) }));
  }

  function alSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resultado = validarCriterios(criterios);
    setErrores(resultado.errores);
  }

  return (
    <form onSubmit={alSubmit} aria-label="Criterios del viaje" className="formulario">
      <div className="campo">
        <label htmlFor="destino_o_tipo">Destino o tipo de viaje</label>
        <input
          id="destino_o_tipo"
          type="text"
          value={criterios.destino_o_tipo}
          onChange={(e) => setCriterios((c) => ({ ...c, destino_o_tipo: e.target.value }))}
        />
      </div>

      <fieldset>
        <legend>Fechas o época</legend>
        <label>
          <input
            type="radio"
            name="modo_fechas"
            checked={criterios.fechas.modo === "epoca"}
            onChange={() => setCriterios((c) => ({ ...c, fechas: { modo: "epoca", epoca: "" } }))}
          />
          Usar una época del año
        </label>
        {criterios.fechas.modo === "epoca" && (
          <input
            aria-label="Época del año"
            type="text"
            value={criterios.fechas.epoca}
            onChange={(e) => setCriterios((c) => ({ ...c, fechas: { modo: "epoca", epoca: e.target.value } }))}
          />
        )}
        <label>
          <input
            type="radio"
            name="modo_fechas"
            checked={criterios.fechas.modo === "fechas"}
            onChange={() => setCriterios((c) => ({ ...c, fechas: { modo: "fechas", inicio: "", fin: "" } }))}
          />
          Usar fechas concretas
        </label>
        {criterios.fechas.modo === "fechas" && (
          <div className="fila">
            <input
              aria-label="Fecha de inicio"
              type="date"
              value={criterios.fechas.inicio}
              onChange={(e) =>
                setCriterios((c) => ({
                  ...c,
                  fechas: { modo: "fechas", inicio: e.target.value, fin: c.fechas.modo === "fechas" ? c.fechas.fin : "" },
                }))
              }
            />
            <input
              aria-label="Fecha de fin"
              type="date"
              value={criterios.fechas.fin}
              onChange={(e) =>
                setCriterios((c) => ({
                  ...c,
                  fechas: { modo: "fechas", inicio: c.fechas.modo === "fechas" ? c.fechas.inicio : "", fin: e.target.value },
                }))
              }
            />
          </div>
        )}
      </fieldset>

      <div className="campo">
        <label htmlFor="dias">Número de días</label>
        <input
          id="dias"
          type="number"
          min={1}
          max={60}
          value={criterios.dias}
          onChange={(e) => setCriterios((c) => ({ ...c, dias: Number(e.target.value) }))}
        />
      </div>

      <fieldset>
        <legend>Personas y edades</legend>
        {criterios.personas.map((persona, indice) => (
          <div key={indice} className="fila">
            <label htmlFor={`edad-${indice}`}>Persona {indice + 1}, edad</label>
            <input
              id={`edad-${indice}`}
              type="number"
              min={0}
              max={120}
              value={persona.edad}
              onChange={(e) => actualizarPersona(indice, Number(e.target.value))}
            />
            {criterios.personas.length > 1 && (
              <button type="button" onClick={() => quitarPersona(indice)}>
                Quitar
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={añadirPersona}>
          + Añadir persona
        </button>
      </fieldset>

      <div className="campo">
        <label htmlFor="perfil">Perfil de viaje</label>
        <select
          id="perfil"
          value={criterios.perfil}
          onChange={(e) => setCriterios((c) => ({ ...c, perfil: e.target.value as Perfil }))}
        >
          <option value="familiar">Familiar</option>
          <option value="amigos">Con amigos</option>
          <option value="pareja">En pareja</option>
          <option value="solo">En solitario</option>
        </select>
      </div>

      <div className="campo">
        <label htmlFor="presupuesto_eur">Presupuesto total (€)</label>
        <input
          id="presupuesto_eur"
          type="number"
          min={1}
          value={criterios.presupuesto_eur}
          onChange={(e) => setCriterios((c) => ({ ...c, presupuesto_eur: Number(e.target.value) }))}
        />
      </div>

      <fieldset>
        <legend>Alojamiento (opcional, solo si ya lo has reservado)</legend>
        <label>
          <input
            type="checkbox"
            checked={conAlojamiento}
            onChange={(e) => {
              setConAlojamiento(e.target.checked);
              setCriterios((c) => ({ ...c, alojamiento: e.target.checked ? { direccion: "" } : undefined }));
            }}
          />
          Ya tengo alojamiento reservado
        </label>
        {conAlojamiento && (
          <input
            aria-label="Dirección del alojamiento"
            type="text"
            value={criterios.alojamiento?.direccion ?? ""}
            onChange={(e) => setCriterios((c) => ({ ...c, alojamiento: { direccion: e.target.value } }))}
          />
        )}
      </fieldset>

      <button type="submit">Continuar</button>

      {errores.length > 0 && (
        <ul role="alert" className="pila">
          {errores.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
