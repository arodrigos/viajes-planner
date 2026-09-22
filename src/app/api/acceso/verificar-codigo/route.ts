import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { procesarVerificacionCodigo } from "@/lib/auth/verificarCodigo";
import { CODIGO_VALIDO } from "@/lib/auth/codigoValido";

// cod-ac1/cod-ac2: 200 con cookies de sesión si el código es correcto; 401
// sin cookies si es incorrecto, caducado o ya consumido; 400 sin llamar a
// Supabase Auth si la petición está mal formada. cod-ac3: 403 sin hablar
// con Supabase Auth si el correo no está en la lista blanca.
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
      return NextResponse.json({ error: "código incorrecto o caducado" }, { status: 401 });
    case "correo-no-permitido":
      return NextResponse.json({ error: "correo no autorizado" }, { status: 403 });
    case "configuracion-invalida":
      return NextResponse.json({ error: resultado.motivo }, { status: 500 });
  }
}
