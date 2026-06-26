import type { ReactNode, CSSProperties } from "react";

/**
 * Pill/Badge reutilizável (Spec 018 / Fatia A2).
 * Substitui 8 pills inline (prioridade, status, subtime, "inativo", relação).
 *
 * Eixos:
 * - tone:   solid | soft | outline | neutral
 * - size:   sm (11px) | md (12px)
 * - weight: normal | semibold | bold  (o código antigo variava por site)
 * - color:  hex dinâmico (PRIORITY_COLOR/STATUS_COLOR) p/ solid|soft|outline.
 *           Aplicado via `style` inline — cor de runtime não vira utilitário,
 *           e de quebra evita conflito de classes do Tailwind.
 *
 * `neutral` é a escape hatch: só estrutura (raio/padding/fonte). Fundo, cor
 * de texto e borda vêm via `className` (ex.: bg-surface-2 / border / text-ink-faint).
 * Use `className="shrink-0"` onde a pill mora numa linha flex (era flexShrink:0).
 */
type BadgeTone = "solid" | "soft" | "outline" | "neutral";
type BadgeSize = "sm" | "md";
type BadgeWeight = "normal" | "semibold" | "bold";

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
  className = "",
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  weight?: BadgeWeight;
  color?: string;
  className?: string;
  children: ReactNode;
}) {
  let toneCls = "";
  let style: CSSProperties = {};

  if (tone === "solid") {
    toneCls = "text-white";
    style = { background: color || "#999" };
  } else if (tone === "soft") {
    style = { color: color || "var(--color-ink-soft)", background: (color || "#999") + "1a" };
  } else if (tone === "outline") {
    toneCls = "border";
    style = { color: color || "var(--color-ink-soft)", borderColor: color || "var(--color-border)" };
  }
  // neutral: estrutura só; fundo/cor/borda vêm via className.

  const cls = `inline-flex items-center whitespace-nowrap rounded-full ${SIZE[size]} ${WEIGHT[weight]} ${toneCls} ${className}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
