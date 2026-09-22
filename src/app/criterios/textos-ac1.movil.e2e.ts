import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// correo fijo, no timestamp: necesita recibir el correo REAL en Mailpit, y
// solo los correos de la lista blanca de CI (ver ci.yml) llegan a disparar
// `signInWithOtp` -igual que pantalla-ac5.movil.e2e.ts.
const EMAIL = "ci-test-textos-ac1@example.com";
const DESTINO_1 = "Cracovia";
const DESTINO_2 = "Split";

// txt-ac1/txt-ac2: un solo recorrido, en el mismo contexto de navegador,
// porque txt-ac2 es justo la vuelta que txt-ac1 deja preparada -no tiene
// sentido probarlas por separado, ya que lo que prueba txt-ac2 es que la
// SEGUNDA vez no hace falta repetir lo que costó la primera.
test("antes y después de pedir el código explica que es un inicio de sesión, y la sesión sobrevive a un segundo viaje", async ({
  page,
}) => {
  const supabase = clienteDePrueba("servicio");

  // --- txt-ac1: primer viaje, sin sesión previa. ---

  await page.goto("/criterios");

  // (a) el aviso previo, visible ANTES de pedir el código.
  const avisoPrevio = page.getByText(/inicio de sesión/i).first();
  await expect(avisoPrevio).toBeVisible();
  await expect(avisoPrevio).toContainText(/cuenta/i);

  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO_1);
  await page.getByLabel("Época del año", { exact: true }).fill("invierno");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Tu correo").fill(EMAIL);
  await page.getByRole("button", { name: "Pedir código de acceso" }).click();

  // (b) el paso del código repite la misma idea, ya en su propio texto.
  const pasoCodigo = page.getByRole("form", { name: "Introducir código" });
  await expect(pasoCodigo).toBeVisible();
  await expect(pasoCodigo).toContainText(/inicio de sesión/i);
  await expect(pasoCodigo).toContainText(/cuenta/i);

  // (c) teclear el código REAL leído de Mailpit -sin interceptar la llamada
  // a Supabase- y comprobar que el trabajo se encola de verdad.
  const codigo = await leerCodigo(EMAIL);
  await page.getByLabel("Código de acceso").fill(codigo);
  await page.getByRole("button", { name: "Confirmar código" }).click();
  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const idPrimerTrabajo = new URL(page.url()).pathname.split("/").pop()!;

  const { data: usuarios, error: errorUsuarios } = await supabase.auth.admin.listUsers({ perPage: 10000 });
  if (errorUsuarios) throw new Error(`No se pudo listar usuarios: ${errorUsuarios.message}`);
  const usuarioId = usuarios.users.find((u) => u.email === EMAIL)?.id;
  if (!usuarioId) throw new Error(`No se encontró la cuenta creada para ${EMAIL}`);

  const { data: primerTrabajo, error: errorPrimero } = await supabase
    .from("trabajos")
    .select("usuario_id, criterios")
    .eq("id", idPrimerTrabajo)
    .single();
  if (errorPrimero || !primerTrabajo) throw new Error(`No se encontró el trabajo ${idPrimerTrabajo}: ${errorPrimero?.message}`);
  expect(primerTrabajo.usuario_id).toBe(usuarioId);
  expect(primerTrabajo.criterios).toMatchObject({ destino_o_tipo: DESTINO_1 });

  // --- txt-ac2: vuelta a /criterios, MISMO contexto de navegador. ---

  await page.goto("/criterios");
  await page.getByLabel("Destino o tipo de viaje").fill(DESTINO_2);
  await page.getByLabel("Época del año", { exact: true }).fill("verano");
  await page.getByRole("button", { name: "Continuar" }).click();

  // (a) la sesión sigue viva: nunca aparece el panel de acceso.
  await expect(page.getByRole("form", { name: "Pedir acceso" })).not.toBeVisible();

  // el trabajo se encola directamente, sin pasar por ningún paso de acceso.
  await page.waitForURL(/\/trabajos\/[^/]+$/);
  const idSegundoTrabajo = new URL(page.url()).pathname.split("/").pop()!;
  expect(idSegundoTrabajo).not.toBe(idPrimerTrabajo);

  // (b) la pantalla explica por qué no ha pedido código: sigue con la
  // sesión iniciada en este navegador.
  await expect(page.getByText(/sesión que iniciaste/i)).toBeVisible();

  // (c) dos filas de ese usuario en `trabajos` -el límite es de 5 por hora,
  // dos caben de sobra.
  const { data: trabajosDelUsuario, error: errorLista } = await supabase
    .from("trabajos")
    .select("id, criterios")
    .eq("usuario_id", usuarioId);
  if (errorLista) throw new Error(`No se pudo listar los trabajos del usuario: ${errorLista.message}`);
  expect(trabajosDelUsuario).toHaveLength(2);
  expect(trabajosDelUsuario?.map((t) => (t.criterios as { destino_o_tipo: string }).destino_o_tipo).sort()).toEqual(
    [DESTINO_1, DESTINO_2].sort(),
  );
});
