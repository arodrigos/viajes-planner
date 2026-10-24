import { NextRequest, NextResponse } from "next/server";
import { requireSesion } from "@/lib/auth/sesion";
import { clienteServicio } from "@/lib/db/cliente";
import { aPlanPublico } from "@/lib/plan/publico";
import { reservasOpcionales } from "@/lib/reservas/repositorio";
import { conEstadoGoogle, leerEstadosGoogle } from "@/lib/google/estados";
import { aPlanCompartido } from "@/lib/plan/compartido";
import { contarMiembros } from "@/lib/plan/miembros";
import { opcionesTramosDeTrabajo, rolEnPlan } from "@/lib/plan/propiedad";
import { ErrorLecturaPlan, recuperarPlan, type PasoLecturaPlan } from "@/lib/plan/repositorio";

// reg-ac3: estos son los mismos estados "en vuelo" de regenerar.ts -- aquí
// solo para decidir si se muestra el aviso, nunca para bloquear nada.
const ESTADOS_EN_VUELO = ["encolado", "en-curso", "pausado-por-cuota"];

// El 500 dice en qué paso falló y con qué mensaje: solo texto de error de la
// base o del código (nunca filas del plan), recortado y sin uuids, para que
// quien lo reproduzca desde fuera sepa dónde mirar sin leer los logs.
function respuestaFalloLectura(fallo: unknown, pasoPorDefecto: PasoLecturaPlan) {
  const paso = fallo instanceof ErrorLecturaPlan ? fallo.paso : pasoPorDefecto;
  const detalle = (fallo instanceof Error ? fallo.message : "error desconocido")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .slice(0, 300);
  console.error(`GET /api/plan: falló el paso ${paso}:`, detalle);
  return NextResponse.json({ error: "no se pudo leer el plan", paso, detalle }, { status: 500 });
}

// El plan de otro usuario responde 404, no 403 (mismo criterio que
// /api/trabajos/[id]): no hay que confirmarle a nadie que un identificador
// existe si no es suyo.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/plan/[id]">) {
  const sesion = await requireSesion(request);
  if (sesion instanceof Response) return sesion;

  const { id } = await ctx.params;
  const supabase = clienteServicio();

  const rol = await rolEnPlan(supabase, id, sesion);
  if (!rol) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  const { trabajo } = rol;

  // Un plan que no se puede leer deja la vista en «Cargando…» para siempre:
  // el mensaje de la causa (sin datos del plan) va al log de la función, que
  // es lo único que permite diagnosticarlo después.
  let plan;
  try {
    plan = await recuperarPlan(supabase, id);
  } catch (fallo) {
    return respuestaFalloLectura(fallo, "plan");
  }
  if (!plan) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const cabeceras = { "x-plan-leido-en": new Date().toISOString() };

  // reg-ac4: mientras la regeneración está en vuelo, la versión anterior
  // sigue siendo la que ve el usuario -- este aviso es lo único que avisa
  // de que se va a sustituir, con el enlace a la pantalla de progreso.
  const regenerando = trabajo.regenerado_en !== null && ESTADOS_EN_VUELO.includes(trabajo.estado);

  try {
    const opciones = opcionesTramosDeTrabajo(trabajo);
    const publico = aPlanPublico(plan, opciones.perfil, trabajo.presupuesto_eur, opciones.transporte, trabajo.intereses, await reservasOpcionales(supabase, id));
    // compartir-datos: el miembro recibe la proyección sin dinero ni alojamiento,
    // ni el id del trabajo, ni el aviso de regeneración, ni el estado de Google.
    if (rol.rol === "miembro") return NextResponse.json(aPlanCompartido(publico), { headers: cabeceras });
    // El estado de Google es un extra: si su lectura falla, el plan sale igual.
    const conGoogle = await leerEstadosGoogle(supabase, plan).then(
      (estados) => conEstadoGoogle(publico, estados),
      () => publico,
    );
    // La hora de lectura la pone el servidor (no la cabecera Date, que un
    // intermediario puede tocar): el SW solo guarda respuestas que la traen.
    const compartidoCon = await contarMiembros(supabase, id);
    return NextResponse.json({ ...conGoogle, regenerando, trabajoId: trabajo.id, ...(compartidoCon > 0 ? { compartidoCon } : {}) }, { headers: cabeceras });
  } catch (fallo) {
    return respuestaFalloLectura(new ErrorLecturaPlan("presentar", fallo instanceof Error ? `${fallo.name}: ${fallo.message}` : "error desconocido"), "presentar");
  }
}
