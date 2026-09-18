import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { obtenerTrabajo } from "@/lib/cola/consultar";

// El trabajo de otro usuario responde 404, no 403: no hay que confirmarle a
// nadie que un identificador existe si no es suyo (mismo criterio que el
// modelo de amenazas aplica a los planes).
export async function GET(request: NextRequest, ctx: RouteContext<"/api/trabajos/[id]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();
  const trabajo = await obtenerTrabajo(supabase, id, sesion.usuarioId);
  if (!trabajo) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }
  return NextResponse.json(trabajo);
}
