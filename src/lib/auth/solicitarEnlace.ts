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
// Desviación de diseño (acceso-ac4/ac6): el diseño original pasaba aquí el
// origen de la petición entrante y lo mandaba como `emailRedirectTo`, para
// que el enlace volviera al mismo despliegue (local, preview de Vercel o
// producción) sin variables de entorno nuevas. Contra la pila real de
// Supabase Auth, `emailRedirectTo` no se refleja en la plantilla del enlace
// mágico (la variable `{{ .RedirectTo }}` cae en silencio a `site_url`
// aunque la URL esté en `additional_redirect_urls`): el correo real
// entregado en CI enlazaba a la raíz de `site_url`, sin ruta ni parámetros.
// El propio patrón que documenta Supabase para este tipo de plantilla usa
// `{{ .SiteURL }}` en vez de `{{ .RedirectTo }}` (ver
// supabase/templates/magic_link.html), así que el origen de destino pasa a
// ser `site_url` -uno por entorno, configurado donde corresponda (dashboard
// en producción, config.toml en local/CI)- y no algo que esta función deba
// calcular por petición. `shouldCreateUser` se deja en su valor por defecto
// a propósito: ponerlo en `false` impediría el primer acceso de un familiar
// autorizado, y la lista blanca ya es la puerta.
export async function procesarSolicitudEnlace(
  supabase: SupabaseClient,
  correo: string,
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

  const { error } = await supabase.auth.signInWithOtp({ email: correo });
  if (error) throw new Error(`No se pudo enviar el enlace mágico: ${error.message}`);
  return { estado: "enviado" };
}
