import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfiguracionCorreosPermitidosVacia, correoPermitido } from "./allowlist";

export type ResultadoVerificacionCodigo =
  | { estado: "verificado" }
  | { estado: "codigo-incorrecto" }
  | { estado: "correo-no-permitido" }
  | { estado: "configuracion-invalida"; motivo: string };

// Separada de la Route Handler por el mismo motivo que procesarSolicitudEnlace:
// poder probar el orden de las dos operaciones sin depender de una petición
// HTTP real. ESE ORDEN ES LA DECISIÓN DE SEGURIDAD DEL BLOQUE (cod-ac3):
// `verifyOtp({ email, token })` acepta cualquier correo del proyecto
// Supabase COMPARTIDO por toda la flota, así que la lista blanca se
// comprueba ANTES de llamar a Supabase Auth -- si se invirtiera el orden,
// este producto serviría de oráculo de canje para los usuarios de los
// demás productos del proyecto compartido.
export async function procesarVerificacionCodigo(
  supabase: SupabaseClient,
  correo: string,
  codigo: string,
): Promise<ResultadoVerificacionCodigo> {
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

  const { error } = await supabase.auth.verifyOtp({ email: correo, token: codigo, type: "email" });
  if (error) return { estado: "codigo-incorrecto" };
  return { estado: "verificado" };
}
