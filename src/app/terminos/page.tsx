import Link from "next/link";

// leg-ac1: página pública (sin sesión) porque los términos de Google Maps
// exigen que quien ve su contenido pueda leerlos antes de entrar. Sin nombres
// propios ni correos: es un repo público y esta página sale en capturas.
export default function TerminosPage() {
  return (
    <main className="contenedor pila">
      <h1>Términos</h1>
      <p>
        Esta aplicación es de uso personal y familiar: prepara planes de viaje y no hace reservas ni cobra nada. Los
        planes son una propuesta; antes de ir conviene comprobar horarios y precios en la web oficial del sitio.
      </p>

      <h2>Contenido de Google Maps</h2>
      <p>
        La aplicación incluye contenido de Google Maps: la ficha de un sitio con sus opiniones, su valoración y su
        horario, que Google muestra dentro de la parada cuando abres el panel «Opiniones y horario · Google Maps». Ese
        contenido es de Google y de sus autores, se muestra con su atribución y no se guarda aquí. Al usarlo aceptas
        los{" "}
        <a href="https://maps.google.com/help/terms_maps/" rel="noopener noreferrer">
          Términos adicionales de Google Maps
        </a>
        .
      </p>

      <h2>Otras fuentes</h2>
      <p>
        El mapa, los lugares y las fotos salen de servicios abiertos: OpenFreeMap, OpenStreetMap (a través de
        Nominatim y Overpass), Wikipedia, Wikimedia Commons y Wikidata. Cada dato enlaza a su fuente, con la licencia
        que le corresponde.
      </p>

      <h2>Más información</h2>
      <p>
        Qué datos salen a cada servicio está en la página de <Link href="/privacidad">Privacidad</Link>.
      </p>
    </main>
  );
}
