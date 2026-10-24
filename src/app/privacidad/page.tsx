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

      <h2>Notas de los sitios que añades</h2>
      <p>
        Cuando añades un sitio a un día puedes escribir una nota. La nota se guarda con el plan, y la ven quienes
        tengan acceso a él. No se envía a ningún servicio externo: a las fuentes de arriba solo les llega el nombre
        del sitio y la ciudad.
      </p>

      <h2>Reservas y gastos</h2>
      <p>
        Si apuntas reservas (vuelos, trenes, hotel o entradas con hora) o gastos del viaje, se guardan con el plan:
        tipo, fechas y horas, origen y destino, nombre, dirección, localizador, notas, la ubicación del hotel si la
        das, y de los gastos su importe, día, categoría y concepto. Los usas tú para ver tu día; no se envían al
        modelo, ni a Nominatim, Overpass, Google ni a ningún otro servicio externo. Solo quien creó el viaje las ve y las
        cambia. Las personas con quienes compartes el viaje ven únicamente el tipo y la hora de cada reserva, nunca el
        localizador, los nombres, las direcciones ni las notas, y no ven los gastos. Las reservas y los gastos se
        borran al eliminar el viaje. Los gastos que apuntas sin conexión esperan en este dispositivo hasta subirse, y
        la copia de los gastos se borra de él al cerrar sesión o al eliminar el viaje.
      </p>

      <h2>Copia del plan en este dispositivo</h2>
      <p>
        Para que puedas ver un plan sin cobertura, la aplicación guarda en este dispositivo una copia de los planes
        que has abierto.
      </p>
      <ul>
        <li>
          <strong>Qué se guarda:</strong> los datos del plan abierto y las fotos de Wikimedia Commons que ya has visto.
          Nunca nada de Google.
        </li>
        <li>
          <strong>Dónde:</strong> en el almacenamiento del navegador, o de la aplicación instalada, de este
          dispositivo. No sale de él.
        </li>
        <li>
          <strong>Cuánto tiempo:</strong> hasta 90 días, o hasta que cierres sesión.
        </li>
        <li>
          <strong>Cómo borrarla:</strong> cierra sesión en Mis viajes, o elimina el viaje.
        </li>
      </ul>
    </main>
  );
}
