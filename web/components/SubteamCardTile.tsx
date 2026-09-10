"use client";
// components/SubteamCardTile.tsx
// Um cartão de subtime na grade — Spec 047, revisão de 10/09.
//
// ⚠️⚠️ O CARTÃO INTEIRO É CLICÁVEL, e a pergunta dela foi essa: *"o card
// inteiro poderia ser clicável né? em todas as versões de permissão"*. Antes
// só o NOME era link, e o resto do cartão era área morta — o alvo de clique
// era uma linha de texto dentro de uma caixa de 200px.
//
// ⚠️⚠️ E O LINK É UMA CAMADA, e não um `<a>` em volta de tudo: `<button>`
// dentro de `<a>` é HTML inválido, e o navegador desfaz o aninhamento por
// conta própria — o lápis deixaria de funcionar. A camada (`absolute inset-0`)
// cobre o cartão, e o lápis fica ACIMA dela num `z-10`. É o "stretched link":
// o cartão inteiro vira alvo, e o link continua sendo um link de verdade —
// abre em nova aba com o meio do mouse, e o teclado o alcança.
//
// ⚠️ O LÁPIS SÓ PARA QUEM ADMINISTRA: *"eu como operador deve aparecer somente
// os cards clicáveis para eu ver quem está no time e o cargo, nada mais"*.
// Sem a permissão, a gaveta abriria só para leitura — e um botão que leva a
// uma tela onde não há nada a fazer é pior que a ausência dele.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest.

import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import AnimatedOutline from "@/components/AnimatedOutline";
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
  // ⚠️ O contorno acende no hover DO CARTÃO e no foco DO LINK -- os dois são
  // "este é o alvo", e um só dos dois deixaria o teclado sem destaque.
  const [aceso, setAceso] = useState(false);

  return (
    <div
      className="relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
      onMouseEnter={() => setAceso(true)}
      onMouseLeave={() => setAceso(false)}
    >
      {/* ⚠️ O contorno DESENHADO substitui o `outline` do CSS, que aparecia
          inteiro de uma vez e não acompanhava o raio do cartão. */}
      <AnimatedOutline show={aceso} radius={8} />

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">
          {card.team.name}
        </span>
        {canManage && (
          <button
            type="button"
            // ⚠️ `relative z-10`: ele precisa ficar ACIMA da camada do link,
            // senão o clique no lápis navega em vez de abrir a gaveta.
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

      {/* ⚠️ A CAMADA DO LINK VEM POR ÚLTIMO no DOM e cobre o cartão inteiro.
          O texto de dentro continua selecionável? Não — e é o preço conhecido
          do stretched link. Vale: o alvo de clique passa de uma linha de texto
          para a caixa toda, que é o que ela pediu. */}
      <Link
        href={`/times/${card.team.id}`}
        aria-label={`Abrir ${card.team.name}`}
        className="absolute inset-0 rounded-lg"
        onFocus={() => setAceso(true)}
        onBlur={() => setAceso(false)}
      />
    </div>
  );
}
