import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// viajes-ac5: cierre de sesión real contra Supabase Auth (no solo borrar la
// cookie a mano), mismo patrón de `setAll` sobre la respuesta que
// verificar-codigo/route.ts pero en sentido inverso -aquí `signOut` es quien
// decide qué cookies expirar.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");

  const respuesta = NextResponse.json({ ok: true });
  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          respuesta.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.signOut();
  return respuesta;
}
