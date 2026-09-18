// acceso-ac2: "el arranque falla si la lista blanca está vacía". Vercel no
// tiene un proceso de arranque persistente (cada función se invoca por
// petición), así que el equivalente real es que el build falle si el
// despliegue va a arrancar sin la variable: se ejecuta como "prebuild".
import { ConfiguracionCorreosPermitidosVacia, correosPermitidos } from "../src/lib/auth/allowlist";

try {
  correosPermitidos();
  process.exit(0);
} catch (error) {
  if (error instanceof ConfiguracionCorreosPermitidosVacia) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
