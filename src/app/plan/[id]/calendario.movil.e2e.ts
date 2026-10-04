import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { guardarPlan } from "@/lib/plan/repositorio";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";
import type { Plan } from "@/lib/plan/tipos";

// ics-ac2: viewport móvil real, mismo patrón que destino.movil.e2e.ts.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-calendario@example.com";
const DESTINO = "Córdoba";

function planDeUnaParada(id: string): Plan {
  const franjas = franjasComoArray(DESTINO);
  return {
    id,
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [
      {
        fecha: "2026-11-10",
        franjas,
        paradas: [
          {
            id: "p-calendario-a",
            franja_id: franjas[0].id,
            nombre: "Mezquita-Catedral",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            coordenadas: { lat: 37.8789, lon: -4.7794 },
          },
        ],
      },
    ],
  };
}

async function iniciarSesion(contexto: import("@playwright/test").BrowserContext, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

// ics-ac2: el enlace existe, tiene objetivo táctil >=44x44 y descarga un
// fichero .ics real al pulsarlo.
test("«Añadir al calendario» descarga un fichero .ics (ics-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-calendario-e2e-${Date.now()}`;
  await guardarPlan(supabase, planDeUnaParada(planId));
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 }, acceptDownloads: true });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, EMAIL);

  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  const enlace = pagina.getByRole("link", { name: "Añadir al calendario" });
  await expect(enlace).toBeVisible();

  const elementos = await medirObjetivosTactiles(pagina);
  const objetivoEnlace = elementos.find((el) => el.descripcion.includes("Añadir al calendario"));
  expect(objetivoEnlace?.alto).toBeGreaterThanOrEqual(44);
  expect(objetivoEnlace?.ancho).toBeGreaterThanOrEqual(44);

  const [descarga] = await Promise.all([pagina.waitForEvent("download"), enlace.click()]);
  expect(descarga.suggestedFilename()).toBe("cordoba.ics");

  await contexto.close();
});
