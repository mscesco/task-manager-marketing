import type { CSSProperties } from "react";
import { corAvatar, iniciais } from "@/lib/people";

/**
 * Avatar circular com iniciais (Spec 018 / Fatia A3).
 * Substitui 6 avatares inline (TaskCard, TaskDetail ×4, membros).
 *
 * - `name`   deriva as iniciais; ausente/vazio → "?"
 * - `id`     deriva a cor de fundo via corAvatar(id)
 * - `color`  sobrepõe a cor (ex.: comentário de autor removido → cinza)
 * - `size`   xs 18 / sm 20 / md 24 / lg 32 (fonte proporcional)
 * - `style`  passthrough (ex.: marginLeft negativa pra empilhar)
 *
 * Cor de fundo é runtime → vai inline via `style`, não vira utilitário.
 * `shrink-0` embutido: avatar nunca encolhe em linha flex.
 */
type AvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE: Record<AvatarSize, string> = {
  xs: "w-[18px] h-[18px] text-[8.5px]",
  sm: "w-[20px] h-[20px] text-[9.5px]",
  md: "w-[24px] h-[24px] text-[10px]",
  lg: "w-[32px] h-[32px] text-[12px]",
};

export default function Avatar({
  name,
  id,
  color,
  size = "sm",
  title,
  className = "",
  style,
}: {
  name?: string;
  id?: string;
  color?: string;
  size?: AvatarSize;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const bg = color ?? (id ? corAvatar(id) : "#999");
  const cls = `inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 select-none ${SIZE[size]} ${className}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <span title={title} className={cls} style={{ background: bg, ...style }}>
      {name ? iniciais(name) : "?"}
    </span>
  );
}
