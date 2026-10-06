// vista-por-dias: las marcas se explican una sola vez aquí (PAIR: explicación
// única, marcas breves y consistentes en las tarjetas).
export function ComoLeerPlan() {
  return (
    <details className="como-leer-plan">
      <summary>Cómo leer este plan</summary>
      <ul className="pila">
        <li>
          <strong>Ubicación comprobada</strong>: el sitio se ha localizado en OpenStreetMap o Wikipedia.
        </li>
        <li>
          <strong>Sin comprobar</strong>: no se ha podido localizar en los mapas abiertos; revisa nombre y dirección antes de ir.
        </li>
        <li>
          <strong>Lo dice el planificador</strong>: es la opinión del modelo que ha armado el plan, no un dato verificado.
        </li>
        <li>
          <strong>≈</strong>: tiempo estimado por distancia, no por rutas reales.
        </li>
        <li>Los enlaces son búsquedas en un mapa, no reservas.</li>
      </ul>
    </details>
  );
}
