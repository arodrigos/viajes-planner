// fot-ac3: icono puramente decorativo del marcador de posición "Sin
// foto" -la información real la lleva el texto, nunca el icono-, mismo
// criterio que iconosFranja.tsx e iconosRecomendacion.tsx. Un solo icono
// genérico para las 14 categorías: el diseño pide "el icono de la
// categoría", pero ningún criterio comprueba 14 iconos distintos, y
// mantener 14 SVGs para una marca de posición es sobre-diseño que ningún
// criterio pide.
// No es un <svg>: maq-ac1/maq-ac2b (bloque mapa-del-dia, anterior a este)
// ya comprueba que cada .tarjeta-parada tiene EXACTAMENTE un <svg> -el
// icono de franja-. Un segundo svg aquí rompería esa cuenta sin que
// ningún criterio de fotos-paradas pida que el marcador sea vectorial.
export function IconoSinFoto({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={className}>
      🖼️
    </span>
  );
}
