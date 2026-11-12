"use client";
// Cartão de subtime na grade, todo clicável. O link é uma camada (`absolute inset-0`),
// não um `<a>` em volta: `<button>` dentro de `<a>` é inválido e quebraria o lápis.
// O lápis (abre a gaveta) só aparece para quem administra.

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useDrawnOutline } from "@/components/AnimatedOutline";
import type { SubteamCard } from "@/lib/teamScreen";

export default function SubteamCardTile({
  card,
  canManage,
  onEdit,
}: {
  card: SubteamCard;
  canManage: boolean;
  onEdit: () => void;
}) {
  // O contorno acende no hover do cartão e no foco do link (teclado).
  const { target, outline } = useDrawnOutline();

  return (
    <div
      className="relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
      onMouseEnter={target.onMouseEnter}
      onMouseLeave={target.onMouseLeave}
    >
      {outline}

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">
          {card.team.name}
        </span>
        {canManage && (
          <button
            type="button"
            // `z-10`: acima da camada do link, senão o clique navega.
            className="btn btn-ghost relative z-10"
            aria-label={`Editar ${card.team.name}`}
            onClick={onEdit}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="muted text-xs">
        {card.pessoas} {card.pessoas === 1 ? "pessoa" : "pessoas"}
        {card.subteams > 0 &&
          ` · ${card.subteams} ${card.subteams === 1 ? "subtime" : "subtimes"}`}
      </div>

      {/* Camada do link: por último no DOM, cobre o cartão (o texto deixa de ser selecionável). */}
      <Link
        href={`/times/${card.team.id}`}
        aria-label={`Abrir ${card.team.name}`}
        className="absolute inset-0 rounded-lg"
        onFocus={target.onFocus}
        onBlur={target.onBlur}
      />
    </div>
  );
}
