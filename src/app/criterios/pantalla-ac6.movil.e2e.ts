import { expect, test, type APIRequestContext } from "@playwright/test";
import { leerCorreo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// pantalla-ac6: el correo real, tal como lo entrega Mailpit, para los dos
// casos que usan una plantilla distinta en Supabase Cloud -enlace mágico
// para quien ya existe en auth.users, alta para quien no- y que por eso hay
// que probar los dos por separado (magic_link.html y confirmation.html
// imprimen el mismo texto, pero solo probando ambos recorridos se detecta
// si alguien deja de tocar una de las dos).
async function pedirYCanjear(peticion: APIRequestContext, email: string): Promise<{ html: string; codigo: string }> {
  const respuestaSolicitud = await peticion.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);

  const { html } = await leerCorreo(email);
  const codigos = [...html.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  // (a) exactamente un grupo de seis dígitos, y es el que canjea con éxito.
  expect(codigos).toHaveLength(1);
  const codigo = codigos[0];

  // (b) ningún href hacia el origen de la app, hacia /auth/v1/verify ni
  // hacia el `site_url` configurado -de hecho, sin ningún <a href> en
  // absoluto: la plantilla nueva no construye ninguna URL.
  expect(html).not.toMatch(/<a\s[^>]*href/i);
  expect(html).not.toMatch(/127\.0\.0\.1:3000/);
  expect(html).not.toMatch(/127\.0\.0\.1:9999/);
  expect(html).not.toMatch(/\/auth\/v1\/verify/);

  const respuestaVerificar = await peticion.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  return { html, codigo };
}

test("el correo de un usuario ya existente trae solo el código, sin ningún enlace", async ({ request }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-pantalla-ac6-existente@example.com";
  const { error, data: creado } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !creado.user) throw new Error(`No se pudo preparar el usuario existente: ${error?.message}`);

  await pedirYCanjear(request, email);
});

// (c) EL CASO DEL USUARIO NUEVO: el correo autorizado no existe todavía en
// auth.users -comprobado antes de empezar- porque es la plantilla de alta
// (confirmation.html en Supabase Cloud) la que se sirve en ese primer
// acceso, no la del enlace mágico, y las dos tienen que decir lo mismo.
test("el correo del primer acceso de un usuario nuevo también trae solo el código, sin ningún enlace", async ({ request }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-pantalla-ac6-nuevo@example.com";

  const { data: paginaUsuarios, error } = await supabase.auth.admin.listUsers({ perPage: 10000 });
  if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`);
  expect(paginaUsuarios.users.map((u) => u.email)).not.toContain(email);

  await pedirYCanjear(request, email);
});
