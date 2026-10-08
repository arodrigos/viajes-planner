import { defineConfig, devices } from "@playwright/test";
import { RUTA_SESION } from "./src/verificacion/entorno";

// ver-ac1: el proyecto preview solo existe con URL_OBJETIVO, así que el CI
// (que no la define) ni lo lista ni arranca nada de él.
const URL_OBJETIVO = process.env.URL_OBJETIVO;

// La suite preview usa una sesión real y el acceso al despliegue protegido.
// Si falla una petición, el registro de Playwright vuelca sus cabeceras, y en
// GitHub Actions de un repo público ese registro es público: nunca allí.
if (URL_OBJETIVO && process.env.GITHUB_ACTIONS) {
  throw new Error("La suite preview no se ejecuta en GitHub Actions");
}

export default defineConfig({
  testDir: "./src",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  reporter: "list",
  // El plan de prueba es uno y los casos lo modifican: un solo proceso.
  workers: URL_OBJETIVO ? 1 : undefined,
  globalSetup: URL_OBJETIVO ? "./src/verificacion/plan-prueba.ts" : undefined,
  use: {
    // Bloque codigo-en-la-misma-pantalla: YA NO tiene que coincidir con
    // [auth].site_url de supabase/config.toml -de hecho, a propósito, no
    // coincide (ese ajuste apunta a http://127.0.0.1:9999, un origen donde
    // no corre nada). El código de acceso se teclea a mano; ninguna
    // plantilla de correo construye ya una URL contra este puerto, así que
    // el puerto de la app bajo prueba es libre de ser el que convenga.
    baseURL: "http://127.0.0.1:3000",
    // Una traza solo cuando un test reintenta: deja el porqué de un fallo
    // inestable en el artefacto sin pagar su coste en cada ejecución.
    trace: "on-first-retry",
  },
  projects: [
    // Los e2e de escritorio que ya existían siguen corriendo tal cual,
    // sin duplicarse bajo el proyecto móvil: visual-ac3 exige que no se
    // toquen sus aserciones, no que se ejecuten dos veces.
    { name: "chromium", testIgnore: /\.(movil|preview)\.e2e\.ts$/, use: { ...devices["Desktop Chrome"] } },
    // visual-ac1/ac2: viewport de teléfono real (Pixel 5, 393x851), que es
    // el que produce las capturas y mide la geometría realmente renderizada.
    { name: "movil", testMatch: /\.movil\.e2e\.ts$/, use: { ...devices["Pixel 5"] } },
    ...(URL_OBJETIVO
      ? [
          {
            name: "preview",
            testMatch: /\.preview\.e2e\.ts$/,
            // El plan de prueba es compartido y varios casos escriben en él
            // (sustituir una parada, marcar una visita): en serie.
            fullyParallel: false,
            use: {
              ...devices["Pixel 5"],
              baseURL: URL_OBJETIVO,
              // Ni cookies ni códigos de acceso deben acabar en una traza.
              trace: "off" as const,
              storageState: RUTA_SESION,
            },
          },
        ]
      : []),
  ],
  // Contra un preview ya desplegado no hay nada que compilar ni arrancar.
  webServer: URL_OBJETIVO
    ? undefined
    : {
        command: "npm run build && npm run start -- -p 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
        timeout: 180000,
      },
});
