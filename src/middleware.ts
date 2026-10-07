import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Patrón documentado de @supabase/ssr para Next.js: sin esto, el token de
// sesión caduca a la hora (auth.jwt_expiry) y la pantalla de progreso de un
// trabajo "pausado-por-cuota" -que puede durar bastante más que una hora-
// se encontraría con una sesión muerta a mitad de la espera.
//
// `/guia`, `/terminos` y `/privacidad` son explícitamente públicas y sin
// sesión por diseño: quedan fuera del matcher para que la renovación de
// sesión nunca las toque.
export async function middleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) return respuesta;

  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        respuesta = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) respuesta.cookies.set(name, value, options);
      },
    },
  });

  // Solo renovar: ninguna redirección aquí. La puerta de autorización real
  // (sesión + lista blanca) sigue viviendo en requireSesion, por endpoint.
  await supabase.auth.getUser();

  return respuesta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|guia|terminos|privacidad).*)"],
};
