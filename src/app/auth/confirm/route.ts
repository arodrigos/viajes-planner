import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { destinoSeguro } from "@/lib/auth/destinoSeguro";

// Cliente propio, distinto del de sesion.ts: aquél es de solo lectura
// (`setAll: () => {}`) porque no tiene una respuesta en la que escribir.
// Esta ruta SÍ tiene que poner la cookie de sesión, así que necesita su
// propio `setAll` que escriba sobre la respuesta de redirección.
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Ni `new URL(request.url)` ni `request.nextUrl` valen aquí: bajo
  // `next start` los dos devuelven "localhost" como host sin importar el
  // Host real de la petición, y el enlace del correo manda a la app por ese
  // host real (127.0.0.1 en local/CI). La cabecera Host es la única fuente
  // fiable, porque es literalmente la que mandó el navegador en la petición.
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const protocolo = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origen = `${protocolo}://${host}`;

  const redirigirAError = () => NextResponse.redirect(new URL("/criterios?acceso=error", origen));

  if (!tokenHash || !type) return redirigirAError();

  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");

  // seg-ac1/seg-ac2: `next` es entrada del usuario (viene del propio enlace
  // de correo, que un tercero puede fabricar con cualquier valor) y nunca
  // se sanea para reutilizarlo -- se valida contra la lista blanca de rutas
  // relativas del propio origen y, si no lo es, cae al destino por defecto.
  // La sesión se crea igual: el token es del usuario, un `next` hostil no
  // es motivo para negarle el acceso, solo para no llevarle donde pide.
  //
  // `destinoSeguro` devuelve el `URL` YA RESUELTO y validado: no se vuelve
  // a envolver en `new URL(..., origen)` aquí. Esa segunda resolución era
  // el fallo real (ver el comentario de `destinoSeguro`) -- un `pathname`
  // como `//sitio-ajeno.example`, que dentro del objeto ya resuelto es
  // inofensivo, se reinterpreta como protocol-relative si se vuelve a
  // parsear como cadena suelta.
  const destinoExito = destinoSeguro(next, origen);
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
