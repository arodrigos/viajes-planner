import { NextResponse, type NextRequest } from "next/server";
import { clienteServicio } from "@/lib/db/cliente";
import { construirSalud, ESQUEMA_VERSION } from "@/lib/salud";
import { MODELO_ACCESO } from "@/lib/trabajador/config";
import vercelConfig from "../../../../vercel.json";

// __SECRET:*__ del manifiesto, tal como los declara: los cinco que necesita
// la mitad web para arrancar de verdad.
const SECRETOS_REQUERIDOS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SCHEMA",
  "CRON_SECRET",
  "CORREOS_PERMITIDOS",
] as const;

// Estas variables no deberían existir jamás en el entorno de la mitad web:
// son las credenciales con las que VPS1 invoca `claude` bajo la suscripción
// de Adrián. Si alguna aparece aquí, la frontera entre las dos mitades
// (modelo de amenazas, mitigación de credenciales) se ha roto.
const VARIABLES_CREDENCIAL_MODELO = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_API_KEY"] as const;

async function comprobarSupabase(): Promise<{ estado: "activa" | "error"; vistoHaceSeg: number | null }> {
  try {
    const supabase = clienteServicio();
    const { data, error } = await supabase
      .from("salud")
      .select("registrado_en")
      .eq("origen", "trabajador-vps1")
      .order("registrado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const vistoHaceSeg = data ? Math.floor((Date.now() - new Date(data.registrado_en).getTime()) / 1000) : null;
    return { estado: "activa", vistoHaceSeg };
  } catch {
    return { estado: "error", vistoHaceSeg: null };
  }
}

// esqueleto-ac1: además de identificar el commit desplegado, este es el
// "touch" que evita que Supabase pause el proyecto por inactividad — el
// cron diario de Vercel manda Authorization: Bearer $CRON_SECRET solo (Vercel
// docs, "Securing cron jobs"), así una invocación externa sin el secreto no
// deja huella en `salud`, aunque la lectura de GET siga siendo pública (así
// es como el propio smoke test del manifiesto la invoca, sin cabecera).
async function tocarSiEsElCron(request: NextRequest, supabaseActiva: boolean): Promise<void> {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || !supabaseActiva) return;
  if (request.headers.get("authorization") !== `Bearer ${secreto}`) return;
  await clienteServicio().from("salud").insert({ origen: "cron-salud" });
}

export async function GET(request: NextRequest) {
  const { estado, vistoHaceSeg } = await comprobarSupabase();
  await tocarSiEsElCron(request, estado === "activa");

  const salud = construirSalud({
    cronsRegistrados: vercelConfig.crons.length,
    supabase: estado,
    esquema: process.env.SUPABASE_SCHEMA,
    esquemaVersion: ESQUEMA_VERSION,
    modeloAcceso: MODELO_ACCESO,
    trabajadorVistoHaceSeg: vistoHaceSeg,
    secretosFaltantes: SECRETOS_REQUERIDOS.filter((nombre) => !process.env[nombre]),
    credencialesModeloEnWeb: VARIABLES_CREDENCIAL_MODELO.some((nombre) => Boolean(process.env[nombre])),
    fuentes: { lugares: "osm+wikipedia", mapa: "openfreemap" },
  });
  return NextResponse.json(salud, { status: salud.ok ? 200 : 503 });
}
