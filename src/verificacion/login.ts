import type { APIRequestContext } from "@playwright/test";
import { variable } from "./entorno";

// El código de acceso es de un solo uso y el usuario de pruebas lo recibe ya
// emitido: pedir uno nuevo por el formulario lo invalidaría. Por eso se canjea
// con el mismo endpoint que usa el formulario, y los valores nunca se imprimen:
// un fallo dice solo el estado HTTP.
export async function iniciarSesion(peticiones: APIRequestContext): Promise<void> {
  const respuesta = await peticiones.post("/api/acceso/verificar-codigo", {
    data: { email: variable("CORREO_ACCESO"), codigo: variable("CODIGO_ACCESO") },
  });
  if (!respuesta.ok()) throw new Error(`El canje del código de acceso falló con HTTP ${respuesta.status()}`);
}
