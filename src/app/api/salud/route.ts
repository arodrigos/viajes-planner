import { NextResponse } from "next/server";
import { construirSalud } from "@/lib/salud";
import vercelConfig from "../../../../vercel.json";

// En este bloque todavía no hay más dependencias que comprobar: cuota de
// suscripción y trabajador amplían este mismo endpoint en bloques
// posteriores. crons_registrados (latido-ac2) sale de vercel.json importado
// como módulo, no leído del disco en runtime: así el bundler lo empaqueta
// con la función y el número no puede desincronizarse del despliegue real.
export async function GET() {
  const salud = construirSalud([], vercelConfig.crons.length);
  return NextResponse.json(salud, { status: salud.ok ? 200 : 503 });
}
