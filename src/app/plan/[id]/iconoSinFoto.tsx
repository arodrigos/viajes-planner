// fot-ac3: icono puramente decorativo del marcador de posición "Sin
// foto" -la información real la lleva el texto, nunca el icono-, mismo
// criterio que iconosFranja.tsx e iconosRecomendacion.tsx. Un solo icono
// genérico para las 14 categorías: el diseño pide "el icono de la
// categoría", pero ningún criterio comprueba 14 iconos distintos, y
// mantener 14 SVGs para una marca de posición es sobre-diseño que ningún
// criterio pide.
export function IconoSinFoto({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10.5" r="2" />
      <path d="M3 16l4.5-4.5a1.5 1.5 0 0 1 2.12 0L14 15.88M14.5 12.5l1.5-1.5a1.5 1.5 0 0 1 2.12 0L21 14.38" />
    </svg>
  );
}
