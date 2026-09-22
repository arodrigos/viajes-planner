"use client";

import { useEffect, useRef, useState } from "react";

type Paso = "email" | "codigo";

const SEGUNDOS_REENVIO = 60;
const CODIGO_VALIDO = /^\d{6}$/;

// pantalla-ac5/ac6: la pantalla que pide el correo cuando `POST /api/plan`
// responde 401, ahora en dos pasos DENTRO DE LA MISMA PÁGINA -correo y
// código-, sin ningún enlace ni redirección de por medio. `onVerificado` lo
// llama quien nos monta (FormularioCriterios) en cuanto el canje del código
// responde 200, para reenviar los criterios que tiene en memoria.
export function PanelAcceso({ onVerificado }: { onVerificado: () => void }) {
  const [paso, setPaso] = useState<Paso>("email");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [segundosParaReenvio, setSegundosParaReenvio] = useState(0);
  const campoCodigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (segundosParaReenvio <= 0) return;
    const id = setInterval(() => setSegundosParaReenvio((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [segundosParaReenvio]);

  // pantalla-ac8(d): la respuesta de solicitar-codigo es UNIFORME para un
  // correo autorizado y uno que no lo está (mismo estado, mismo cuerpo), así
  // que esta función nunca ramifica por ese motivo: si la petición responde
  // bien, siempre se pasa al paso del código, esté o no el correo permitido.
  async function pedirCodigo() {
    setEnviandoEmail(true);
    setErrorEmail(null);
    try {
      const respuesta = await fetch("/api/acceso/solicitar-codigo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!respuesta.ok) {
        setErrorEmail("No se ha podido enviar el código. Inténtalo de nuevo en un momento.");
        return;
      }
      setPaso("codigo");
      setSegundosParaReenvio(SEGUNDOS_REENVIO);
    } catch {
      setErrorEmail("No se ha podido enviar el código. Comprueba tu conexión.");
    } finally {
      setEnviandoEmail(false);
    }
  }

  async function alSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    await pedirCodigo();
  }

  async function alSubmitCodigo(e: React.FormEvent) {
    e.preventDefault();
    setEnviandoCodigo(true);
    setErrorCodigo(null);
    try {
      const respuesta = await fetch("/api/acceso/verificar-codigo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, codigo }),
      });
      if (respuesta.ok) {
        onVerificado();
        return;
      }
      // pantalla-ac8(a,b): cod-ac2 responde el mismo 401 tanto si el código
      // es incorrecto, como si ha caducado, como si ya se ha usado -así que
      // el mensaje tampoco distingue, pero cubre las dos acciones válidas:
      // reintentar (puede ser un error al teclear) o pedir uno nuevo (puede
      // estar caducado o consumido). El campo se limpia y recupera el foco
      // sin perder ni el correo ni los criterios, que viven fuera de aquí.
      setErrorCodigo("Ese código no es correcto, ha caducado o ya se ha usado. Puedes volver a intentarlo o pedir uno nuevo.");
      setCodigo("");
      campoCodigoRef.current?.focus();
    } catch {
      setErrorCodigo("No se ha podido comprobar el código. Comprueba tu conexión.");
    } finally {
      setEnviandoCodigo(false);
    }
  }

  if (paso === "email") {
    return (
      <form onSubmit={alSubmitEmail} aria-label="Pedir acceso" className="formulario">
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
            Solo funcionan los correos autorizados de la familia. Te enviaremos un código de seis dígitos por correo.
          </p>
        </div>
        <button type="submit" disabled={enviandoEmail}>
          {enviandoEmail ? "Enviando…" : "Pedir código de acceso"}
        </button>
        {errorEmail && (
          <p role="alert" className="pila">
            {errorEmail}
          </p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={alSubmitCodigo} aria-label="Introducir código" className="formulario">
      <p role="status">Te hemos enviado un código a {email}. Escríbelo aquí sin salir de esta pantalla.</p>
      <div className="campo">
        <label htmlFor="codigo-acceso">Código de seis dígitos</label>
        <input
          id="codigo-acceso"
          ref={campoCodigoRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          aria-describedby="ayuda-codigo-acceso"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        {/* aud-ac4/aud-ac5: el título citado tiene que ser el mismo que imprime
            supabase/templates/magic_link.html y confirmation.html -no el nombre
            del producto, que esas plantillas ya no llevan por ser comunes a
            Auth entero-, y el aviso del enlace cubre el estado real de hoy en
            producción sin distinguir si el correo está en la lista blanca. */}
        <p id="ayuda-codigo-acceso" className="ayuda">
          El código llega en un correo con el asunto «Tu código de acceso»: seis dígitos, sin ningún enlace que
          abrir. Si lo que te llega es un enlace en vez de un código, falta un ajuste del correo: avisa a Adrián.
          Caduca en una hora, es de un solo uso, y si no te llega puedes pedir otro cada 60 segundos.
        </p>
      </div>
      <button type="submit" disabled={enviandoCodigo || !CODIGO_VALIDO.test(codigo)}>
        {enviandoCodigo ? "Comprobando…" : "Confirmar código"}
      </button>
      <button type="button" onClick={() => void pedirCodigo()} disabled={segundosParaReenvio > 0 || enviandoEmail}>
        {segundosParaReenvio > 0 ? `Pedir otro código (${segundosParaReenvio} s)` : "Pedir otro código"}
      </button>
      {errorCodigo && (
        <p role="alert" className="pila">
          {errorCodigo}
        </p>
      )}
    </form>
  );
}
