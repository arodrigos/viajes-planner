import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

// Cliente propio, distinto del de sesion.ts: aquél es de solo lectura
// (`setAll: () => {}`) porque no tiene una respuesta en la que escribir.
// Esta ruta SÍ tiene que poner la cookie de sesión, así que necesita su
// propio `setAll` que escriba sobre la respuesta de redirección.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  console.log(`[debug auth/confirm] request.url: ${request.url} origin: ${url.origin}`);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/criterios";

  const redirigirAError = () => NextResponse.redirect(new URL("/criterios?acceso=error", url.origin));

  if (!tokenHash || !type) return redirigirAError();

  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");

  const destinoExito = new URL(next, url.origin);
  destinoExito.searchParams.set("acceso", "confirmado");
  const respuestaExito = NextResponse.redirect(destinoExito);

  const supabase = createServerClient(supabaseUrl, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          respuestaExito.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  // acceso-ac6(a): token inválido, caducado o ya usado -> sin crear ninguna
  // cookie. `respuestaExito` nunca se devuelve en este camino, así que su
  // `setAll` (si algo llegó a escribir en ella antes del error) tampoco.
  if (error) return redirigirAError();

  return respuestaExito;
}
