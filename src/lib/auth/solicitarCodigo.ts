import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfiguracionCorreosPermitidosVacia, correoPermitido } from "./allowlist";

export type ResultadoSolicitudCodigo =
  | { estado: "enviado" }
  | { estado: "correo-no-permitido" }
  | { estado: "configuracion-invalida"; motivo: string };

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

  const { error } = await supabase.auth.signInWithOtp({ email: correo });
  if (error) throw new Error(`No se pudo enviar el código: ${error.message}`);
  return { estado: "enviado" };
}
