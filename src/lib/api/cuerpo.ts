import { NextResponse } from "next/server";

// Un cuerpo que no se puede parsear es un fallo del cliente (400), no un 500
// del manejador; el texto es el que ya devolvían las rutas que lo comparten.
export async function leerCuerpoJson(request: Request): Promise<{ cuerpo: unknown } | { respuesta: NextResponse }> {
  try {
    return { cuerpo: await request.json() };
  } catch {
    return { respuesta: NextResponse.json({ error: "el cuerpo de la petición no es JSON válido" }, { status: 400 }) };
  }
}
