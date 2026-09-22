import { expect } from "@playwright/test";

// Puerto fijo por config.toml ([local_smtp]): `supabase start` lo publica
// igual en cualquier entorno local o de CI, así que no hace falta leerlo de
// `supabase status` como el resto de credenciales (SUPABASE_URL etc.).
const URL_MAILPIT = "http://127.0.0.1:54324";

interface MensajeResumen {
  ID: string;
  To: { Address: string }[];
}

async function buscarMensaje(email: string): Promise<MensajeResumen | undefined> {
  const respuesta = await fetch(`${URL_MAILPIT}/api/v1/messages?limit=50`);
  if (!respuesta.ok) throw new Error(`Mailpit respondió ${respuesta.status} al listar mensajes`);
  const { messages } = (await respuesta.json()) as { messages: MensajeResumen[] };
  return messages.find((mensaje) => mensaje.To?.some((destinatario) => destinatario.Address === email));
}

// pantalla-ac5/ac6 piden probar la entrega real del correo, no interceptar
// la llamada a Supabase Auth: este helper lee el correo tal como lo
// recibiría el usuario, desde la API real de Mailpit que expone
// `supabase start` en local. El envío es asíncrono, así que se sondea en
// vez de asumir que ya ha llegado tras la petición HTTP que lo dispara.
export async function leerCorreo(email: string): Promise<{ html: string }> {
  let mensaje: MensajeResumen | undefined;
  await expect
    .poll(
      async () => {
        mensaje = await buscarMensaje(email);
        return mensaje !== undefined;
      },
      { message: `Mailpit no ha recibido ningún correo para ${email}`, timeout: 30_000, intervals: [250] },
    )
    .toBe(true);

  const respuesta = await fetch(`${URL_MAILPIT}/api/v1/message/${mensaje!.ID}`);
  if (!respuesta.ok) throw new Error(`Mailpit respondió ${respuesta.status} al leer el mensaje`);
  const { HTML } = (await respuesta.json()) as { HTML: string };
  return { html: HTML };
}

// Sustituye a `leerEnlaceMagico` (retirado con el bloque
// codigo-en-la-misma-pantalla): ya no hay ningún enlace que leer, solo un
// código que la plantilla imprime con `{{ .Token }}` -su longitud la decide
// el ajuste de Supabase Auth del proyecto (issue #181: 6 en esta pila
// local, 8 en el proyecto DEV real), nunca un número fijo en este helper.
export async function leerCodigo(email: string): Promise<string> {
  const { html } = await leerCorreo(email);
  const codigo = html.match(/\b(\d{6,10})\b/)?.[1];
  if (!codigo) throw new Error("El correo no contiene ningún código de acceso");
  return codigo;
}
