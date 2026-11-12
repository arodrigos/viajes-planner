// Iconos de Lucide (https://lucide.dev, licencia ISC) copiados en línea: así no
// se añade una dependencia por un solo trazo. Decorativos: el botón que los
// lleva ya dice lo mismo con texto.
export function IconoFileUp({ tamano = 20 }: { tamano?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 12v6" />
      <path d="m9 15 3-3 3 3" />
    </svg>
  );
}
