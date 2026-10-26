// O símbolo do Oniros, redesenhado do arquivo da Camila (26/10) e girado 45°
// para virar losango. `currentColor`: quem usa decide a cor pelo `color` do
// pai -- o original é branco, e branco fixo some no tema claro.
export default function OnirosMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-13.64 -13.64 127.28 127.28"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(45 50 50)">
        <polygon points="11,0 91,0 74,17 18,17 18,73 0,91 0,11" />
        <polygon points="89,100 9,100 26,83 82,83 82,27 100,9 100,89" />
        <rect x="32" y="32" width="36" height="36" rx="3" />
      </g>
    </svg>
  );
}
