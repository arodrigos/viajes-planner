import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { aPlanPublico } from "@/lib/plan/publico";
import { conEstadoGoogle, leerEstadosGoogle } from "@/lib/google/estados";
import { trabajoDelPlan } from "@/lib/plan/propiedad";
import { recuperarPlan } from "@/lib/plan/repositorio";

// reg-ac3: estos son los mismos estados "en vuelo" de regenerar.ts -- aquí
// solo para decidir si se muestra el aviso, nunca para bloquear nada.
const ESTADOS_EN_VUELO = ["encolado", "en-curso", "pausado-por-cuota"];

// El plan de otro usuario responde 404, no 403 (mismo criterio que
// /api/trabajos/[id]): no hay que confirmarle a nadie que un identificador
// existe si no es suyo.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const trabajo = await trabajoDelPlan(supabase, id, sesion.usuarioId);
  if (!trabajo) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  // Un plan que no se puede leer deja la vista en «Cargando…» para siempre:
  // el mensaje de la causa (sin datos del plan) va al log de la función, que
  // es lo único que permite diagnosticarlo después.
  let plan;
  try {
    plan = await recuperarPlan(supabase, id);
  } catch (fallo) {
    console.error("GET /api/plan: no se pudo leer el plan:", fallo instanceof Error ? fallo.message : "error desconocido");
    return NextResponse.json({ error: "no se pudo leer el plan" }, { status: 500 });
  }
  if (!plan) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  // reg-ac4: mientras la regeneración está en vuelo, la versión anterior
  // sigue siendo la que ve el usuario -- este aviso es lo único que avisa
  // de que se va a sustituir, con el enlace a la pantalla de progreso.
  const regenerando = trabajo.regenerado_en !== null && ESTADOS_EN_VUELO.includes(trabajo.estado);

  try {
    const publico = aPlanPublico(plan, trabajo.perfil, trabajo.presupuesto_eur, trabajo.transporte);
    // El estado de Google es un extra: si su lectura falla, el plan sale igual.
    const conGoogle = await leerEstadosGoogle(supabase, plan).then(
      (estados) => conEstadoGoogle(publico, estados),
      () => publico,
    );
    return NextResponse.json({ ...conGoogle, regenerando, trabajoId: trabajo.id });
  } catch (fallo) {
    console.error("GET /api/plan: no se pudo presentar el plan:", fallo instanceof Error ? fallo.message : "error desconocido");
    return NextResponse.json({ error: "no se pudo leer el plan" }, { status: 500 });
  }
}
