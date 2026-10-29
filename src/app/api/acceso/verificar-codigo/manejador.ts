import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { procesarVerificacionCodigo } from "@/lib/auth/verificarCodigo";
import { CODIGO_VALIDO } from "@/lib/auth/codigoValido";

// cod-ac1/cod-ac2: 200 con cookies de sesión si el código es correcto; 401
// sin cookies si es incorrecto, caducado o ya consumido; 400 sin llamar a
// Supabase Auth si la petición está mal formada. unif-ac1/unif-ac2 (issue
// #39): un correo fuera de la lista blanca NO llega a hablar con Supabase
// Auth (esa comprobación sigue en verificarCodigo.ts, sin tocar), pero hacia
// fuera se cuenta como el MISMO 401 que un código incorrecto -antes era un
// 403 propio que delataba la pertenencia a la lista sin necesitar sesión.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { email, codigo } = (await request.json()) as { email?: string; codigo?: string };
  if (!email || !codigo || !CODIGO_VALIDO.test(codigo)) {
    return NextResponse.json({ error: "email o código inválidos" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) throw new Error("Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el entorno");

  // La cookie de sesión solo se escribe sobre ESTA respuesta si el canje
  // tiene éxito: los demás caminos devuelven una NextResponse distinta, así
  // que un fallo nunca puede dejar `Set-Cookie` puesto (cod-ac2).
  const respuestaExito = NextResponse.json({ ok: true });
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

  const resultado = await procesarVerificacionCodigo(supabase, email, codigo);

  switch (resultado.estado) {
    case "verificado":
      return respuestaExito;
    case "codigo-incorrecto":
    case "correo-no-permitido":
      // unif-ac1/unif-ac2: un solo `return` para los dos estados -no dos
      // llamadas separadas con el mismo texto, que dejarían escapar una
      // diferencia de cuerpo el día que alguien tocara una sin la otra-. El
      // dominio (verificarCodigo.ts) sigue distinguiendo los dos casos para
      // el orden de sus comprobaciones; lo que deja de distinguirse es solo
      // lo que se cuenta hacia fuera.
      return NextResponse.json({ error: "código incorrecto o caducado" }, { status: 401 });
    case "configuracion-invalida":
      // issue #40: el motivo real (nombra la variable de entorno) queda en
      // el registro del servidor, donde lo necesita quien opera el despliegue; hacia
      // fuera solo un 500 genérico, igual que el resto de 500 de esta ruta.
      console.error(`verificar-codigo: configuración inválida: ${resultado.motivo}`);
      return NextResponse.json({ error: "error de configuración del servidor" }, { status: 500 });
  }
}
