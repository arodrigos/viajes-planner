import { expect, test } from "@playwright/test";
import { leerEnlaceMagico } from "@/lib/auth/__tests__/mailpit";

// seg-ac2: correos propios de este test, distintos de ci-test@example.com
// (el de acceso.e2e.ts) y distintos entre sí -- así cada uno tiene un buzón
// de Mailpit con un único mensaje, y no hay que suponer en qué orden
// Mailpit devolvería dos mensajes para la misma dirección.
const EMAIL_NEXT_HOSTIL = "ci-test-seg-ac2-hostil@example.com";
const EMAIL_NEXT_RELATIVO = "ci-test-seg-ac2-relativo@example.com";

// UUID bien formado pero que no existe en `trabajos`: distinto de un id mal
// formado, que Postgres rechazaría con un error antes de poder responder
// 404 (RequireSesion.integration.test.ts ya cubre ese caso mal formado).
const ID_TRABAJO_INEXISTENTE = "00000000-0000-0000-0000-000000000000";

async function pedirEnlace(request: import("@playwright/test").APIRequestContext, email: string): Promise<string> {
  const respuesta = await request.post("/api/acceso/solicitar-enlace", { data: { email } });
  expect(respuesta.ok()).toBe(true);
  return leerEnlaceMagico(email);
}

test.describe("seg-ac2: la ruta viva usa destinoSeguro", () => {
  test("un next hostil deposita al usuario en /criterios del propio origen, con la sesión creada", async ({ request, baseURL }) => {
    const enlace = await pedirEnlace(request, EMAIL_NEXT_HOSTIL);
    const enlaceConNextHostil = `${enlace}&next=${encodeURIComponent("https://ajeno.example/robo")}`;

    const respuesta = await request.get(enlaceConNextHostil, { maxRedirects: 0 });
    expect(respuesta.status()).toBeGreaterThanOrEqual(300);
    expect(respuesta.status()).toBeLessThan(400);

    const origenPropio = new URL(baseURL!).origin;
    const destino = new URL(respuesta.headers()["location"]!, baseURL!);
    expect(destino.origin).toBe(origenPropio);
    expect(destino.pathname).toBe("/criterios");
    // La sesión SÍ se ha creado -- un `next` hostil no es motivo para negar
    // el acceso, solo para no llevar al usuario donde pide.
    expect(destino.searchParams.get("acceso")).toBe("confirmado");

    // Comprobación posterior de que hay sesión de verdad, no solo una
    // redirección que lo parezca: un trabajo inexistente responde 404
    // (autenticado, no encontrado) y no 401 (sin autenticar).
    const respuestaTrabajo = await request.get(`/api/trabajos/${ID_TRABAJO_INEXISTENTE}`);
    expect(respuestaTrabajo.status()).toBe(404);
  });

  test("un next relativo legítimo se respeta, sin amputar el parámetro", async ({ request, baseURL }) => {
    const enlace = await pedirEnlace(request, EMAIL_NEXT_RELATIVO);
    const enlaceConNextRelativo = `${enlace}&next=${encodeURIComponent("/trabajos/abc-123")}`;

    const respuesta = await request.get(enlaceConNextRelativo, { maxRedirects: 0 });
    const destino = new URL(respuesta.headers()["location"]!, baseURL!);
    expect(destino.pathname).toBe("/trabajos/abc-123");
  });
});

// seg-ac2, regresión: `destinoSeguro` validaba bien con
// `new URL(next, origen).origin`, pero devolvía `pathname+search+hash` como
// CADENA y `route.ts` volvía a resolver esa cadena contra el origen. Con un
// `next` que empieza por `/..` el pathname que queda tras la primera
// normalización arranca por doble barra (`//sitio-ajeno.example`), que es
// protocol-relative: la SEGUNDA resolución lo reinterpreta como otro host,
// aunque la primera lo hubiera validado bien. La aserción es sobre el
// ORIGEN DEL `Location` FINAL que compone `route.ts` contra la pila real,
// no sobre lo que devuelve `destinoSeguro` -- un test sobre la función sola
// ya existía (seg-ac1) y no pudo detectar este fallo porque el fallo está
// en la composición, no en la validación. No se amplía la tabla de
// payloads hostiles de seg-ac1 con un caso más: se cierra la clase entera
// de fallo en la composición (ver destinoSeguro.ts) y se prueba aquí,
// contra el Location real, con los siete payloads que encontró el
// gatekeeper.
const PAYLOADS_TRAVESIA = [
  "/..//sitio-ajeno.example",
  "/..//sitio-ajeno.example/robo",
  "/../..//sitio-ajeno.example",
  "/a/../..//sitio-ajeno.example",
  "/%2e%2e//sitio-ajeno.example",
  "/..///sitio-ajeno.example",
  "/..//sitio-ajeno.example#x",
];

test.describe("seg-ac2, regresión de composición: la travesía de rutas no escapa del origen", () => {
  for (const [indice, payload] of PAYLOADS_TRAVESIA.entries()) {
    test(`next=${payload}`, async ({ request, baseURL }) => {
      const email = `ci-test-seg-ac2-travesia-${indice}@example.com`;
      const enlace = await pedirEnlace(request, email);
      const enlaceConTravesia = `${enlace}&next=${encodeURIComponent(payload)}`;

      const respuesta = await request.get(enlaceConTravesia, { maxRedirects: 0 });
      expect(respuesta.status()).toBeGreaterThanOrEqual(300);
      expect(respuesta.status()).toBeLessThan(400);

      const origenPropio = new URL(baseURL!).origin;
      const destino = new URL(respuesta.headers()["location"]!, baseURL!);
      expect(destino.origin).toBe(origenPropio);
    });
  }
});

// seg-ac3: los tres casos comparten que no hace falta un token válido -por
// eso no piden ningún correo ni leen Mailpit- y por eso son la comprobación
// de regresión más barata que hay contra este fallo.
const CASOS_SIN_TOKEN_VALIDO: readonly [nombre: string, query: string][] = [
  ["sin token_hash", ""],
  ["con token_hash inventado", "token_hash=invalido&type=magiclink"],
  [
    "con token_hash inventado y next hostil",
    `token_hash=invalido&type=magiclink&next=${encodeURIComponent("https://ajeno.example")}`,
  ],
];

test.describe("seg-ac3: el camino de error tampoco sale del propio origen", () => {
  for (const [nombre, query] of CASOS_SIN_TOKEN_VALIDO) {
    test(nombre, async ({ request, baseURL }) => {
      const ruta = query ? `/auth/confirm?${query}` : "/auth/confirm";
      const respuesta = await request.get(ruta, { maxRedirects: 0 });
      expect(respuesta.status()).toBeGreaterThanOrEqual(300);
      expect(respuesta.status()).toBeLessThan(400);

      const origenPropio = new URL(baseURL!).origin;
      const destino = new URL(respuesta.headers()["location"]!, baseURL!);
      expect(destino.origin).toBe(origenPropio);
    });
  }
});
