import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { correoPermitido } from "./allowlist";

export interface Sesion {
  usuarioId: string;
  email: string;
}

function clienteDesdeCookies(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      // Guard de solo lectura: no hay respuesta que devolver aquí en la que
      // renovar cookies, así que no se intenta.
      setAll: () => {},
    },
  });
}

export async function obtenerSesion(request: NextRequest): Promise<Sesion | null> {
  const supabase = clienteDesdeCookies(request);
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { usuarioId: data.user.id, email: data.user.email ?? "" };
}

const RESPUESTA_NO_AUTENTICADO = () =>
  new Response(JSON.stringify({ error: "no autenticado" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

const RESPUESTA_CORREO_NO_AUTORIZADO = () =>
  new Response(JSON.stringify({ error: "correo no autorizado" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

// acceso-ac1: los endpoints que consumen cuota rechazan peticiones sin
// sesión válida. Devuelve la sesión o ya la Response 401 lista para usar,
// para que cada endpoint escriba `const s = await requireSesion(req); if (s instanceof Response) return s;`
//
// acceso-ac5: `auth.users` es de un proyecto Supabase COMPARTIDO entre toda
// otros productos, así que tener sesión no basta -- sin repetir esta comprobación
// en cada endpoint, una sesión emitida por otro producto del proyecto podría
// encolar trabajos contra la suscripción del dueño del producto.
export async function requireSesion(request: NextRequest): Promise<Sesion | Response> {
  const sesion = await obtenerSesion(request);
  if (!sesion) return RESPUESTA_NO_AUTENTICADO();
  if (!correoPermitido(sesion.email)) return RESPUESTA_CORREO_NO_AUTORIZADO();
  return sesion;
}
