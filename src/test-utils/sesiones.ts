import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// Ayudantes de los tests de integración con varios usuarios (dueño, miembro,
// ajeno): sesión real contra la pila local de Supabase, sin dobles.
export interface UsuarioDePrueba {
  email: string;
  usuarioId: string;
  cookie: string;
  accessToken: string;
}

export async function usuarioDePrueba(email: string): Promise<UsuarioDePrueba> {
  const servicio = clienteDePrueba("servicio");
  const { data: creado, error } = await servicio.auth.admin.createUser({ email, email_confirm: true });
  let usuarioId = creado?.user?.id;
  if (!usuarioId) {
    const { data: lista } = await servicio.auth.admin.listUsers({ perPage: 1000 });
    usuarioId = lista?.users.find((u) => u.email === email)?.id;
    if (!usuarioId) throw new Error(`No se pudo crear el usuario ${email}: ${error?.message}`);
  }
  const generado = await servicio.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = generado.data?.properties?.hashed_token;
  if (generado.error || !tokenHash) throw new Error(`No se pudo generar el enlace de prueba: ${generado.error?.message}`);
  const jar = new Map<string, string>();
  const cliente = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error: errorOtp } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (errorOtp || !data.session) throw new Error(`No se pudo confirmar el enlace de prueba: ${errorOtp?.message}`);
  return { email, usuarioId, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), accessToken: data.session.access_token };
}

export function peticion(url: string, metodo: string, cookie?: string, cuerpo?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: metodo,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
}

export const contexto = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
