import { Suspense } from "react";
import { ContenidoSinConexion } from "./ContenidoSinConexion";

// Página de respaldo del service worker: estática y sin sesión, del build
// actual (vive en la precache), así que sirve igual sin cobertura. Lo que
// pinta lo lee en el navegador de la copia guardada.
export default function PaginaSinConexion() {
  return (
    <main className="contenedor">
      <Suspense fallback={<h1>Planes guardados en este dispositivo</h1>}>
        <ContenidoSinConexion />
      </Suspense>
    </main>
  );
}
