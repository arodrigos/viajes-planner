"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { guardarBorrador, leerBorrador } from "@/lib/criterios/borrador";
import { validarCriterios } from "@/lib/criterios/validar";
import { hayEnvioPendiente, limpiarEnvioPendiente, marcarEnvioPendiente } from "@/lib/criterios/envioPendiente";
import { PanelAcceso } from "./PanelAcceso";
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

// acceso-ac4/ac6: qué pantalla se muestra dentro de /criterios además del
// propio formulario. "pidiendo-acceso" cubre tanto el 401 al enviar como
// `?acceso=error` (enlace caducado/inválido); "sin-borrador" es el aviso
// explícito de acceso-ac6(b), nunca un formulario vacío en silencio.
type Vista = "formulario" | "pidiendo-acceso" | "sin-borrador";

export function FormularioCriterios() {
  const router = useRouter();
  const [criterios, setCriterios] = useState<CriteriosViaje>(CRITERIOS_INICIALES);
  const [conAlojamiento, setConAlojamiento] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const [cargado, setCargado] = useState(false);
  const [vista, setVista] = useState<Vista>("formulario");
  const [mensajeAcceso, setMensajeAcceso] = useState<string | null>(null);
  const [mensajeEnvio, setMensajeEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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

    // window.location, no useSearchParams: este componente no tiene un
    // límite <Suspense> por encima (page.tsx no lo pone) y no hace falta
    // añadir uno solo para leer un parámetro que solo importa en el cliente.
    const parametros = new URLSearchParams(window.location.search);
    if (parametros.get("acceso") === "error") {
      setMensajeAcceso("El enlace no es válido o ha caducado.");
      setVista("pidiendo-acceso");
      return;
    }
    if (parametros.get("acceso") === "confirmado") {
      if (!borrador) {
        // acceso-ac6(b): el enlace se abrió en un contexto de navegador
        // distinto (p. ej. la vista web aislada del cliente de correo) y
        // este localStorage nunca tuvo el borrador. Hay sesión pero no hay
        // nada que reenviar: decirlo, no mostrar el formulario en blanco.
        setVista("sin-borrador");
        return;
      }
      if (hayEnvioPendiente()) {
        limpiarEnvioPendiente();
        void enviarPlan(borrador);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe ejecutarse una vez, al montar
  }, []);

  useEffect(() => {
    if (cargado) guardarBorrador(criterios);
  }, [criterios, cargado]);

  async function enviarPlan(datos: CriteriosViaje) {
    setEnviando(true);
    setMensajeEnvio(null);
    try {
      const respuesta = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(datos),
      });

      if (respuesta.status === 202) {
        const { id } = (await respuesta.json()) as { id: string };
        router.push(`/trabajos/${id}`);
        return;
      }
      if (respuesta.status === 401) {
        marcarEnvioPendiente();
        setVista("pidiendo-acceso");
        return;
      }
      if (respuesta.status === 429) {
        // acceso-ac6(c): el borrador ya está en localStorage desde el
        // primer cambio (ver el efecto de guardarBorrador); no se toca
        // aquí, así que sobrevive al intento fallido sin hacer nada extra.
        setMensajeEnvio("Has alcanzado el límite de viajes por hora. Puedes volver a intentarlo más tarde: lo escrito no se pierde.");
        return;
      }
      setMensajeEnvio("Los criterios no son válidos. Revisa el formulario e inténtalo de nuevo.");
    } catch {
      setMensajeEnvio("No se ha podido enviar la solicitud. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

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
    if (resultado.valido) void enviarPlan(criterios);
  }

  if (vista === "sin-borrador") {
    return (
      <div className="pila" role="alert">
        <p>Tu sesión ya está iniciada, pero los criterios que escribiste se quedaron en otro navegador.</p>
        <p>Vuelve a la pestaña o app donde los escribiste: ahí se enviarán solos.</p>
      </div>
    );
  }

  if (vista === "pidiendo-acceso") {
    return <PanelAcceso mensaje={mensajeAcceso} />;
  }

  return (
    <form onSubmit={alSubmit} aria-label="Criterios del viaje" className="formulario">
      {enviando && <p role="status">Enviando…</p>}
      {mensajeEnvio && (
        <p role="alert" className="pila">
          {mensajeEnvio}
        </p>
      )}
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

      <button type="submit" disabled={enviando}>
        Continuar
      </button>

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
