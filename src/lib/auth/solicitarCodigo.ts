import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfiguracionCorreosPermitidosVacia, correoPermitido } from "./allowlist";

export type ResultadoSolicitudCodigo =
  | { estado: "enviado" }
  | { estado: "correo-no-permitido" }
  | { estado: "configuracion-invalida"; motivo: string }
  | { estado: "rechazado-por-auth"; tipo: TipoRechazoAuth; status?: number; code?: string };

export type TipoRechazoAuth = "limite-envios" | "correo-invalido" | "fallo-envio";

// Se clasifica por `code` y `status`, nunca por el texto del mensaje, que
// Supabase puede cambiar y que lleva el correo. El `status` solo sirve de
// respaldo cuando el `code` no es uno de los conocidos (o no llega); un 429
// con un code nuevo sigue siendo un límite, no un fallo de envío.
export function clasificarErrorAuth(error: unknown): { tipo: TipoRechazoAuth; status?: number; code?: string } {
  const bruto = (typeof error === "object" && error !== null ? error : {}) as { status?: unknown; code?: unknown };
  const status = typeof bruto.status === "number" ? bruto.status : undefined;
  const code = typeof bruto.code === "string" ? bruto.code : undefined;
  let tipo: TipoRechazoAuth = "fallo-envio";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") tipo = "limite-envios";
  else if (code === "email_address_invalid" || code === "email_address_not_authorized") tipo = "correo-invalido";
  else if (status === 429) tipo = "limite-envios";
  else if (code === undefined && status === 400) tipo = "correo-invalido";
  return { tipo, status, code };
}

// Separado de la Route Handler para poder probar el gate de la lista
// blanca sin depender de una petición HTTP real ni de la entrega de
// correo: acceso-ac1 solo pide que el correo no listado no complete el
// alta, no que se compruebe la bandeja de entrada.
//
// pantalla-ac8(d): la Route Handler responde IGUAL para "enviado" y para
// "correo-no-permitido" -mismo estado, mismo cuerpo-, así que la distinción
// solo existe aquí dentro, nunca en lo que ve el cliente. `shouldCreateUser`
// se deja en su valor por defecto a propósito: ponerlo en `false` impediría
// el primer acceso de un familiar autorizado, y la lista blanca ya es la
// puerta.
//
// Renombrado de `procesarSolicitudEnlace` (bloque codigo-en-la-misma-pantalla):
// la llamada a Supabase Auth es la misma `signInWithOtp({ email })` de
// siempre -lo único que cambia es qué plantilla de correo la sirve
// (supabase/templates/magic_link.html imprime ahora `{{ .Token }}`, no un
// enlace)- así que no hace falta pasar ningún destino de redirección: no hay
// redirección que construir.
export async function procesarSolicitudCodigo(
  supabase: SupabaseClient,
  correo: string,
): Promise<ResultadoSolicitudCodigo> {
  let permitido: boolean;
  try {
    permitido = correoPermitido(correo);
  } catch (error) {
    if (error instanceof ConfiguracionCorreosPermitidosVacia) {
      return { estado: "configuracion-invalida", motivo: error.message };
    }
    throw error;
  }

  if (!permitido) return { estado: "correo-no-permitido" };

  // Una excepción del cliente (red caída, Supabase fuera) es un fallo de
  // envío más: el manejador la trata igual que cualquier rechazo de Auth.
  try {
    const { error } = await supabase.auth.signInWithOtp({ email: correo });
    if (error) return { estado: "rechazado-por-auth", ...clasificarErrorAuth(error) };
  } catch {
    return { estado: "rechazado-por-auth", tipo: "fallo-envio" };
  }
  return { estado: "enviado" };
}
