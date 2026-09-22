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
        <li>Genera un plan día a día a partir de los criterios que escribes.</li>
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
          repetirlo. Ese código es un inicio de sesión -la primera vez crea tu cuenta- para que la aplicación te
          reconozca la próxima vez que vuelvas, sin pedírtelo de nuevo.
        </li>
        <li>El plan no aparece al instante: verás una pantalla de progreso mientras un agente lo genera, y puede tardar varios minutos.</li>
        <li>Cuando termina, el plan vive en su propia dirección: guardarla sigue siendo la forma más directa de volver a verlo.</li>
        <li>
          También puedes encontrarlo sin guardar nada: pulsa «Mis viajes» en el pie de cualquier página y verás la
          lista completa de los viajes pedidos con tu cuenta, con enlace directo a cada uno.
        </li>
      </ol>
    </main>
  );
}
