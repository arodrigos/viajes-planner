"use client";

import { useState } from "react";

type Estado = "formulario" | "enviando" | "enviado" | "error";

// acceso-ac4/ac6: la pantalla que pide el correo cuando `POST /api/plan`
// responde 401. `mensaje` es el aviso de contexto que trae quien la muestra
// (por ejemplo, "el enlace anterior ha caducado"), no un error propio de
// este panel.
export function PanelAcceso({ mensaje }: { mensaje?: string | null }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<Estado>("formulario");
  const [error, setError] = useState<string | null>(null);

  async function alSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    setError(null);
    try {
      const respuesta = await fetch("/api/acceso/solicitar-enlace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (respuesta.ok) {
        setEstado("enviado");
        return;
      }
      if (respuesta.status === 403) {
        // usabilidad-ac8(c): dice qué ha pasado y cómo salir, SIN confirmar
        // ni negar qué otras direcciones están autorizadas (modelo de
        // amenazas: la composición de la lista blanca es dato personal).
        setError("Ese correo no tiene acceso a esta aplicación. Si crees que deberías tenerlo, pídeselo a Adrián.");
      } else {
        setError("No se ha podido enviar el enlace. Inténtalo de nuevo en un momento.");
      }
      setEstado("error");
    } catch {
      setError("No se ha podido enviar el enlace. Comprueba tu conexión.");
      setEstado("error");
    }
  }

  if (estado === "enviado") {
    return (
      <div className="pila" role="status">
        <p>Te hemos enviado un enlace a {email}. Ábrelo desde este mismo dispositivo para continuar.</p>
        <p>Lo que habías escrito sigue guardado: al volver, se envía solo.</p>
        <p>El enlace es de un solo uso, caduca en una hora y solo puedes pedir uno nuevo cada 60 segundos.</p>
      </div>
    );
  }

  return (
    <form onSubmit={alSubmit} aria-label="Pedir acceso" className="formulario">
      {mensaje && (
        <p role="alert">
          {mensaje} Puedes pedir un enlace nuevo.
        </p>
      )}
      <p>Para pedir el plan hace falta confirmar tu correo. Lo que has escrito no se pierde mientras tanto.</p>
      <div className="campo">
        <label htmlFor="email-acceso">Tu correo</label>
        <input
          id="email-acceso"
          type="email"
          required
          aria-describedby="ayuda-email-acceso"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p id="ayuda-email-acceso" className="ayuda">
          Solo funcionan los correos autorizados de la familia. El enlace caduca en una hora, es de un solo uso, y
          solo puedes pedir uno nuevo cada 60 segundos.
        </p>
      </div>
      <button type="submit" disabled={estado === "enviando"}>
        {estado === "enviando" ? "Enviando…" : "Enviar enlace de acceso"}
      </button>
      {error && (
        <p role="alert" className="pila">
          {error}
        </p>
      )}
    </form>
  );
}
