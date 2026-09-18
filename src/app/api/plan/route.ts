import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { crearTrabajoGeneracion } from "@/lib/cola/crear";

// acceso-ac1 / acceso-ac3: sin sesión, 401 (acceso-ac1); criterios
// inválidos, 400; límite superado, 429 (acceso-ac1); si no, 202 con el
// identificador al instante (acceso-ac3).
export async function POST(request: NextRequest) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  let criterios: unknown;
  try {
    criterios = await request.json();
  } catch {
    return NextResponse.json({ error: "el cuerpo de la petición no es JSON válido" }, { status: 400 });
  }

  const supabase = clienteServicio();
  const resultado = await crearTrabajoGeneracion(supabase, sesion.usuarioId, criterios);

  if (resultado.estado === "creado") {
    return NextResponse.json({ id: resultado.id }, { status: 202 });
  }
  if (resultado.estado === "criterios-invalidos") {
    return NextResponse.json({ error: "criterios inválidos", detalle: resultado.errores }, { status: 400 });
  }
  return NextResponse.json({ error: "límite de trabajos por hora superado" }, { status: 429 });
}
