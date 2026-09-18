import { NextResponse } from "next/server";
import { construirSalud } from "@/lib/salud";

// En este bloque (esqueleto) todavía no hay dependencias que comprobar:
// persistencia, cuota de suscripción y trabajador se añaden en bloques
// posteriores y amplían este mismo endpoint.
export async function GET() {
  const salud = construirSalud([]);
  return NextResponse.json(salud, { status: salud.ok ? 200 : 503 });
}
