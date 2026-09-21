import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  reporter: "list",
  use: {
    // Bloque codigo-en-la-misma-pantalla: YA NO tiene que coincidir con
    // [auth].site_url de supabase/config.toml -de hecho, a propósito, no
    // coincide (ese ajuste apunta a http://127.0.0.1:9999, un origen donde
    // no corre nada). El código de acceso se teclea a mano; ninguna
    // plantilla de correo construye ya una URL contra este puerto, así que
    // el puerto de la app bajo prueba es libre de ser el que convenga.
    baseURL: "http://127.0.0.1:3000",
    trace: "off",
  },
  projects: [
    // Los e2e de escritorio que ya existían siguen corriendo tal cual,
    // sin duplicarse bajo el proyecto móvil: visual-ac3 exige que no se
    // toquen sus aserciones, no que se ejecuten dos veces.
    { name: "chromium", testIgnore: /\.movil\.e2e\.ts$/, use: { ...devices["Desktop Chrome"] } },
    // visual-ac1/ac2: viewport de teléfono real (Pixel 5, 393x851), que es
    // el que produce las capturas y mide la geometría realmente renderizada.
    { name: "movil", testMatch: /\.movil\.e2e\.ts$/, use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
