import type { ReactNode, CSSProperties } from "react";

/**
 * Pill/Badge reutilizável.
 *
 * Eixos:
 * - tone:   solid | soft | outline | neutral
 * - size:   sm (11px) | md (12px)
 * - weight: normal | semibold | bold
 * - color:  cor dinâmica (PRIORITY_COLOR/STATUS_TEXT) p/ solid|soft|outline.
 *           Aplicado via `style` inline — cor de runtime não vira utilitário,
 *           e de quebra evita conflito de classes do Tailwind.
 *
 * `neutral` é a escape hatch: só estrutura (raio/padding/fonte). Fundo, cor
 * de texto e borda vêm via `className` (ex.: bg-surface-2 / border / text-ink-faint).
 * Use `className="shrink-0"` onde a pill mora numa linha flex.
 *
 * O fundo do `soft` usa `color-mix` para aceitar hex e `var()`; o texto do
 * `solid` usa `var(--on-chroma)` porque no tema escuro o fundo é claro.
 */
type BadgeTone = "solid" | "soft" | "outline" | "neutral";
type BadgeSize = "sm" | "md";
type BadgeWeight = "normal" | "semibold" | "bold";

// `whitespace-nowrap` sozinho vaza por cima do vizinho num container estreito;
// `overflow-hidden` + `text-ellipsis` + `min-w-0` cortam com reticências.
const SIZE: Record<BadgeSize, string> = {
  sm: "text-xs px-2 py-0.5",
  md: "text-sm px-2.5 py-[3px]",
};
const WEIGHT: Record<BadgeWeight, string> = {
  normal: "font-normal",
  semibold: "font-semibold",
  bold: "font-bold",
};

export default function Badge({
  tone = "neutral",
  size = "md",
  weight = "bold",
  color,
  // A opção da Base é "etiqueta" (raio 5); o resto é pílula. Prop, e não
  // `className`, porque duas classes de raio disputariam sem ordem garantida.
  forma = "pilula",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  weight?: BadgeWeight;
  color?: string;
  forma?: "pilula" | "etiqueta";
  className?: string;
  children: ReactNode;
}) {
  let toneCls = "";
  let style: CSSProperties = {};

  if (tone === "solid") {
    style = { background: color || "var(--color-ink-faint)", color: "var(--on-chroma)" };
  } else if (tone === "soft") {
    const c = color || "var(--color-ink-soft)";
    style = { color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` };
  } else if (tone === "outline") {
    toneCls = "border";
    style = { color: color || "var(--color-ink-soft)", borderColor: color || "var(--color-border)" };
  }
  // neutral: estrutura só; fundo/cor/borda vêm via className.

  const raio = forma === "etiqueta" ? "rounded-[5px] h-5 py-0" : "rounded-full";
  const cls = `inline-flex items-center min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${raio} ${SIZE[size]} ${WEIGHT[weight]} ${toneCls} ${className}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
