import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfiguracionCorreosPermitidosVacia, correoPermitido } from "./allowlist";

export type ResultadoSolicitudEnlace =
  | { estado: "enviado" }
  | { estado: "correo-no-permitido" }
  | { estado: "configuracion-invalida"; motivo: string };

// Separado de la Route Handler para poder probar el gate de la lista
// blanca sin depender de una petición HTTP real ni de la entrega de
// correo: acceso-ac1 solo pide que el correo no listado no complete el
// alta, no que se compruebe la bandeja de entrada.
//
// `origenPeticion` es el origen (protocolo+host) de la petición entrante a
// `/api/acceso/solicitar-enlace`, no una URL fija de configuración: así el
// enlace devuelve al usuario al MISMO despliegue desde el que está usando
// la aplicación (local, preview de Vercel o producción) sin ninguna
// variable de entorno nueva. `shouldCreateUser` se deja en su valor por
// defecto a propósito: ponerlo en `false` impediría el primer acceso de un
// familiar autorizado, y la lista blanca ya es la puerta.
export async function procesarSolicitudEnlace(
  supabase: SupabaseClient,
  correo: string,
  origenPeticion: string,
): Promise<ResultadoSolicitudEnlace> {
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

  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    options: { emailRedirectTo: `${origenPeticion}/auth/confirm` },
  });
  if (error) throw new Error(`No se pudo enviar el enlace mágico: ${error.message}`);
  return { estado: "enviado" };
}
