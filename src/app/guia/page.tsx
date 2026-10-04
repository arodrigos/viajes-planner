// guia-ac7: página pública (sin sesión) que explica la aplicación a quien
// llega por primera vez. Discreción deliberada -guia-ac7(d)-: ningún correo,
// nombre ni destino reales, para que una captura de esta página no filtre
// nada de la familia que la usa.
export default function GuiaPage() {
  return (
    <main className="contenedor pila">
      <h1>Guía: cómo funciona esta aplicación</h1>
      <p>
        Esta aplicación prepara un plan de viaje día a día. Le cuentas qué buscas -destino o tipo de viaje, fechas,
        personas, presupuesto- y un agente genera un itinerario para ti. No hace reservas ni paga nada: solo propone
        paradas y horarios para que decidas tú.
      </p>

      <h2>Qué hace</h2>
      <ul>
        <li>
          Genera un plan día a día a partir de los criterios que escribes, con recomendaciones de sitios cercanos.
        </li>
        <li>
          Guarda cada plan en una dirección propia y, además, lo reúne en «Mis viajes»: una lista de todos tus
          viajes con destino, fecha y estado, accesible desde el pie de cualquier página.
        </li>
        <li>Avisa cuando algo se retrasa o se pausa, en vez de fallar en silencio.</li>
      </ul>

      <h2>El recorrido, paso a paso</h2>
      <ol>
        <li>Empieza en la portada y pulsa «Cuéntanos tu viaje».</li>
        <li>Rellena el formulario: destino o tipo de viaje, fechas, personas y presupuesto.</li>
        <li>
          Al enviarlo, te pedirá tu correo y te mandará un código de acceso. Solo funcionan los correos ya
          autorizados para la familia.
        </li>
        <li>
          Escribe el código en esa misma pantalla, sin salir de ella: lo que habías escrito sigue ahí, no hace falta
          repetirlo. Ese código es un inicio de sesión ligado a tu correo -la primera vez crea tu cuenta- para que la
          aplicación te reconozca la próxima vez que vuelvas, sin pedírtelo de nuevo.
        </li>
        <li>
          El plan no aparece al instante: verás una pantalla de progreso mientras un agente lo genera, y puede
          tardar varios minutos.
        </li>
        <li>
          Cuando termina, el itinerario se ve como una línea de tiempo: cada día tiene sus franjas horarias
          -mañana, comida, tarde, noche- con las paradas agrupadas dentro de cada franja.
        </li>
        <li>
          Cada parada localizada en OpenStreetMap o Wikipedia aparece como «comprobada», con acceso directo a esa
          fuente; si no se ha podido localizar, dice «Sin comprobar».
        </li>
        <li>
          Con alguna parada comprobada, aparece un mapa con un marcador numerado por parada y el recorrido entre
          ellas (teselas de OpenStreetMap vía OpenFreeMap); si no carga, la lista sigue intacta y «Abrir el
          recorrido en Google Maps» sigue funcionando.
        </li>
        <li>
          Junto al itinerario hay recomendaciones de sitios de comida y de recintos cercanos: cada una abre una
          búsqueda de ese sitio en el mapa, nunca una reserva ni un listado verificado.
        </li>
        <li>
          Encuentra cualquier plan sin guardar ninguna dirección: pulsa «Mis viajes» en el pie de cualquier página
          y verás la lista completa de los viajes pedidos con tu cuenta, cada uno con acceso directo a su plan.
        </li>
        <li>
          Desde «Mis viajes» puedes eliminar un viaje que ya no necesites: confirmas una vez, desaparece de la
          lista y su plan deja de poder abrirse. No se puede deshacer: no hay papelera ni forma de recuperarlo.
        </li>
        <li>
          Si quieres volver a generar un viaje ya hecho -por ejemplo, para que tenga alternativas y las demás
          mejoras de una versión más reciente- pulsa «Regenerar este viaje» en la cabecera de su plan. El plan
          actual se sustituye por uno nuevo generado desde cero, las paradas marcadas como visitadas se pierden,
          tarda unos minutos y consume una generación de tu suscripción: solo se puede hacer una vez por hora por
          viaje.
        </li>
      </ol>
    </main>
  );
}
