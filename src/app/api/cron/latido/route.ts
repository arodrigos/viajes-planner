import { NextRequest, NextResponse } from "next/server";
import { clienteServicio } from "@/lib/db/cliente";
import { refrescarTiposCambio } from "@/lib/cambio/refrescar";

// latido-ac1: sin el secreto de cron, ni se toca la base de datos ni se
// llama al BCE. El secreto de producción vive solo en Vercel (variable de
// entorno del cron), nunca en el repo.
function autorizado(request: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;
  return request.headers.get("authorization") === `Bearer ${secreto}`;
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ ok: false, error: "no autorizado" }, { status: 401 });
  }

  const supabase = clienteServicio();
  // Escribir en "salud" es lo que evita la pausa por inactividad de
  // Supabase (research: unas pocas peticiones al día bastan); no depende de
  // que el refresco del BCE salga bien.
  const { error: errorSalud } = await supabase.from("salud").insert({ origen: "cron-latido" });
  const cambio = await refrescarTiposCambio(supabase);

  return NextResponse.json({
    ok: !errorSalud,
    tipos_cambio: cambio,
  });
}
