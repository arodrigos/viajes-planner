// leg-ac1: pública y sin nombres ni correos, igual que /terminos. Lista, por
// servicio, lo que sale y desde dónde, que es lo que la política de Google
// pide poder decir a quien usa la ficha.
const SERVICIOS = [
  {
    nombre: "OpenFreeMap",
    datos: "Desde tu navegador, la zona del mapa que estás mirando.",
  },
  {
    nombre: "Nominatim y Overpass (OpenStreetMap)",
    datos: "Desde el servidor, el nombre de la parada y el destino, o unas coordenadas redondeadas con un radio.",
  },
  {
    nombre: "Wikipedia, Wikimedia Commons y Wikidata",
    datos: "Desde el servidor, el nombre de la parada o del lugar.",
  },
];

export default function PrivacidadPage() {
  return (
    <main className="contenedor pila">
      <h1>Privacidad</h1>
      <p>
        A ningún servicio externo llegan las fechas del viaje, las edades, el número de personas ni tu correo.
        Esto es lo que sale a cada uno.
      </p>

      <h2>Servicios abiertos</h2>
      <ul>
        {SERVICIOS.map((s) => (
          <li key={s.nombre}>
            <strong>{s.nombre}.</strong> {s.datos}
          </li>
        ))}
      </ul>

      <h2>Google Maps</h2>
      <p>
        La aplicación incluye contenido de Google Maps. Solo se guarda el identificador del lugar en Google, nunca sus
        opiniones, horarios ni fotos.
      </p>
      <ul>
        <li>
          <strong>Desde el servidor:</strong> el nombre de la parada, la ciudad y un rectángulo alrededor de su
          ubicación, para casarla con el lugar de Google. Nunca fechas, usuarios ni identificadores del plan.
        </li>
        <li>
          <strong>Desde tu navegador:</strong> la dirección IP y el agente de usuario, y solo cuando abres el panel
          «Opiniones y horario · Google Maps» de una parada. Antes de abrirlo no se contacta con Google.
        </li>
      </ul>
      <p>
        Google trata esos datos según su{" "}
        <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
          Política de privacidad
        </a>
        .
      </p>
    </main>
  );
}
