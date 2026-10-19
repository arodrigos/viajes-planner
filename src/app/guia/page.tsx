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
          Escribe el código sin salir de esta pantalla: lo que habías escrito sigue ahí, no hace falta repetirlo.
          Ese código es un inicio de sesión ligado a tu correo -la primera vez crea tu cuenta- para que vuelvas sin
          pedírtelo de nuevo.
        </li>
        <li>El plan no aparece al instante: verás una pantalla de progreso mientras un agente lo genera.</li>
        <li>
          Cuando termina, el itinerario se ve como una línea de tiempo: cada día tiene sus franjas horarias
          -mañana, comida, tarde, noche- con las paradas agrupadas dentro de cada franja.
        </li>
        <li>
          Cada parada localizada en OpenStreetMap o Wikipedia aparece como «comprobada», con acceso a esa fuente; si
          no se ha podido localizar, dice «Sin comprobar».
        </li>
        <li>
          Con alguna parada comprobada, aparece un mapa con un marcador numerado por parada y el recorrido entre
          ellas; si no carga, la lista sigue intacta y «Abrir el recorrido en Google Maps» sigue funcionando.
        </li>
        <li>
          El día de tu viaje, cada parada se puede marcar como visitada y verás «Cómo llegar» hasta la siguiente.
        </li>
        <li>
          Junto al itinerario hay recomendaciones de comida y recintos cercanos: cada una abre una búsqueda de ese
          sitio en el mapa, nunca una reserva.
        </li>
        <li>
          Encuentra cualquier plan sin guardar ninguna dirección: pulsa «Mis viajes» en el pie de cualquier página y
          verás la lista de tus viajes, cada uno con acceso directo a su plan.
        </li>
        <li>
          Desde «Mis viajes» puedes eliminar un viaje que ya no necesites: confirmas una vez y su plan deja de poder
          abrirse. No se puede deshacer.
        </li>
        <li>«Regenerar este viaje» pide una versión nueva, como mucho una vez por hora.</li>
      </ol>

      <h2>Instalar en el móvil</h2>
      <p>
        La aplicación se puede instalar como una app más, sin tienda. No hay botón propio: se instala desde el
        navegador.
      </p>
      <ul>
        <li>
          <strong>Android (Chrome):</strong> abre el menú del navegador y pulsa «Instalar aplicación» (o «Añadir a la
          pantalla de inicio»).
        </li>
        <li>
          <strong>iPhone (Safari):</strong> pulsa Compartir y después «Añadir a pantalla de inicio».
        </li>
      </ul>
      <p>
        Antes de viajar, abre el plan una vez desde la app instalada, con conexión. En el iPhone lo que se vio en
        Safari no está en la app instalada, y el plan solo se podrá consultar sin cobertura desde donde lo abriste.
      </p>
      <h2>Usarlo sin conexión</h2>
      <p>
        Un plan que ya has abierto una vez con conexión se sigue viendo sin cobertura: la tarjeta «Ahora», las paradas,
        la guía, las curiosidades y las fotos que ya viste. Arriba aparece un aviso con la fecha de la copia guardada.
        No funcionan sin conexión el mapa, la ficha de Google ni los cambios en el plan. Al cerrar sesión se borra la copia.
      </p>
    </main>
  );
}
