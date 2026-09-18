import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";

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

// acceso-ac1: los endpoints que consumen cuota rechazan peticiones sin
// sesión válida. Devuelve la sesión o ya la Response 401 lista para usar,
// para que cada endpoint escriba `const s = await requireSesion(req); if (s instanceof Response) return s;`
export async function requireSesion(request: NextRequest): Promise<Sesion | Response> {
  const sesion = await obtenerSesion(request);
  return sesion ?? RESPUESTA_NO_AUTENTICADO();
}
