import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { listarViajes } from "@/lib/cola/listar";

// viajes-ac2: no se lee ningún parámetro de la petición -ni query string ni
// cuerpo- para decidir de quién es la lista; el único origen posible del
// usuario_id es la sesión, así que un `?usuario_id=<otro>` no cambia nada.
export async function GET(request: NextRequest) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const supabase = clienteServicio();
  const viajes = await listarViajes(supabase, sesion.usuarioId);
  return NextResponse.json({ correo: sesion.email, viajes });
}
