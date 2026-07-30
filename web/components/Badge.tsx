import type { ReactNode, CSSProperties } from "react";

/**
 * Pill/Badge reutilizável (Spec 018 / Fatia A2).
 * Substitui 8 pills inline (prioridade, status, subtime, "inativo", relação).
 *
 * Eixos:
 * - tone:   solid | soft | outline | neutral
 * - size:   sm (11px) | md (12px)
 * - weight: normal | semibold | bold  (o código antigo variava por site)
 * - color:  cor dinâmica (PRIORITY_COLOR/STATUS_TEXT) p/ solid|soft|outline.
 *           Aplicado via `style` inline — cor de runtime não vira utilitário,
 *           e de quebra evita conflito de classes do Tailwind.
 *
 * `neutral` é a escape hatch: só estrutura (raio/padding/fonte). Fundo, cor
 * de texto e borda vêm via `className` (ex.: bg-surface-2 / border / text-ink-faint).
 * Use `className="shrink-0"` onde a pill mora numa linha flex (era flexShrink:0).
 *
 * --- Spec 031 (C1a): dois defeitos consertados aqui -------------------------
 *
 * 1. FUNDO DO `soft` ERA CONCATENAÇÃO DE STRING, E ISSO JÁ ESTAVA QUEBRADO.
 *    Era `background: (color || "#999") + "1a"` — anexar o alfa hex ao valor.
 *    Funciona com hex; NÃO funciona com variável CSS. Cinco call-sites já
 *    passavam `var(--accent)` / `var(--text-faint)` (minhas-tarefas:586,
 *    TaskDetail:732, :747, :1678): o resultado era `background: var(--accent)1a`,
 *    declaração inválida, DESCARTADA pelo browser. Esses cinco renderizavam
 *    sem fundo nenhum. Falha silenciosa — o texto continuava legível, então
 *    ninguém reclamou.
 *
 *    Agora: `color-mix(in srgb, <cor> 12%, transparent)`. Aceita hex E var(),
 *    resolve em runtime, e acompanha a troca de tema sozinho — no tema escuro
 *    a cor recebida já é o stop claro, e a tinta nasce clara sobre o fundo
 *    escuro. Nenhum call-site precisou mudar.
 *
 *    ⚠️ color-mix exige Chrome 111+ / Safari 16.2+ / Firefox 113+ (todos de
 *    2023). Se algum navegador da equipe for mais velho, a declaração inteira
 *    é ignorada e o badge fica SEM fundo — ou seja, degrada exatamente para o
 *    comportamento de hoje, não para algo pior.
 *
 * 2. `solid` CRAVAVA `text-white`.
 *    Com os tokens da C1a o fundo do solid é o stop `-text`, que no tema
 *    ESCURO é o stop CLARO da família (#fcd34d etc.) — branco por cima
 *    reprovaria. Agora o texto é `var(--on-chroma)`, que é #ffffff no claro e
 *    #161d2b no escuro. Mesmo padrão do `--on-danger` que já existia no
 *    globals.css, e pelo mesmo motivo registrado lá.
 *    Pior contraste medido: 5.02 (claro), 8.46 (escuro).
 */
type BadgeTone = "solid" | "soft" | "outline" | "neutral";
type BadgeSize = "sm" | "md";
type BadgeWeight = "normal" | "semibold" | "bold";

// Spec 031 (C6): `whitespace-nowrap` sozinho e uma armadilha. Quando a pastilha
// mora num container com largura limitada (o wrapper de maxWidth:260 da linha
// de "Minhas tarefas", por exemplo), o flexbox encolhe a CAIXA mas o texto nao
// quebra nem corta -- ele vaza por cima do vizinho. Era o "atravessa o vence em
// 2 dias" reportado. `overflow-hidden` + `text-ellipsis` + `min-w-0` fazem a
// pastilha cortar com reticencias em vez de invadir. Sem largura limitada nada
// muda: nao ha o que cortar.
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
    style = { background: color || "var(--color-ink-faint)", color: "var(--on-chroma)" };
  } else if (tone === "soft") {
    const c = color || "var(--color-ink-soft)";
    style = { color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` };
  } else if (tone === "outline") {
    toneCls = "border";
    style = { color: color || "var(--color-ink-soft)", borderColor: color || "var(--color-border)" };
  }
  // neutral: estrutura só; fundo/cor/borda vêm via className.

  const cls = `inline-flex items-center min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-full ${SIZE[size]} ${WEIGHT[weight]} ${toneCls} ${className}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}
