"use client";
// app/times/[id]/page.tsx
// A tela de UM TIME (Spec 047, fatia C) — onde se administra PESSOAS.
//
// A divisão que a spec estabelece (§4.4), e vale ter em mente ao mexer aqui:
//
//     a tabela  mostra
//     o lápis   define em QUAIS subtimes
//     o painel  define COM QUE CARGO em cada um   (fatia D)
//
// ⚠️ UMA TELA SÓ PARA ÁREA E SUBTIME, e a decisão é explícita: gerir uma área
// e gerir um subtime são públicos diferentes, mas duas telas divergem com o
// tempo — e separar depois é mais fácil do que reunificar.
//
// ⚠️ TODA DECISÃO MORA EM `lib/telaDoTime.ts`, testada. `app/` está fora do
// `include` do vitest, e nesta fatia isso é crítico: as duas regras mais
// delicadas (quem aparece, e o que se perde ao desmarcar) são justamente as
// que não dão erro quando saem erradas.
//
// ⚠️ SEM `useSearchParams` — a rota é dinâmica (`ƒ /times/[id]`, por causa do
// `[id]`), então o `next build` passaria de qualquer forma; mas não há estado
// de URL aqui e não vale inventar um.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import Badge from "@/components/Badge";
import PageHeader from "@/components/PageHeader";
import TabelaDeMembros, { PAPEL } from "@/components/TabelaDeMembros";
import {
  ApiError,
  assignMemberToTeam,
  currentUser,
  deactivateMember,
  listMembers,
  listTeamsAll,
  removeMemberFromTeam,
  type CurrentUser,
  type Member,
  type MemberRole,
  type Team,
} from "@/lib/api";
import {
  cargosQueSePerdem,
  linhasDoTime,
  opcoesDoSeletor,
  subtimesOferecidos,
  type CapsulaDeSubtime,
  type LinhaDoTime,
} from "@/lib/telaDoTime";
import { alcanceDe, podeMoverSubtime } from "@/lib/permissoesMembros";

export default function TimePage() {
  const params = useParams<{ id: string }>();
  const teamId = params.id;

  const [times, setTimes] = useState<Team[]>([]);
  const [membros, setMembros] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  // ⚠️ O `⋯` abre o PAINEL DO MEMBRO (fatia D), e nao uma fileira de botoes.
  // A primeira versao punha "Tirar deste time / Desativar / Fechar" soltos
  // numa linha, e a Camila perguntou: *"como que eu administro dessa forma?"*
  // -- a intencao dela era o `member detail` da referencia, com os times e os
  // papeis.
  const [painelDe, setPainelDe] = useState<Member | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [t, m, u] = await Promise.all([
        listTeamsAll(),
        listMembers(),
        currentUser(),
      ]);
      setTimes(t);
      setMembros(m);
      setMe(u);
      setErro(null);
    } catch (e) {
      setErro((e as ApiError).message || "Não consegui carregar o time.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const time = times.find((t) => t.id === teamId) ?? null;
  const linhas = useMemo(
    () => linhasDoTime(teamId, times, membros),
    [teamId, times, membros],
  );
  const oferecidos = useMemo(
    () => subtimesOferecidos(teamId, times),
    [teamId, times],
  );

  const alcance = alcanceDe(me);
  const podeMexer = podeMoverSubtime(alcance);

  if (!carregando && !time) {
    return (
      <AppShell>
        <div className="muted">
          Time não encontrado. Volte para a{" "}
          <Link href="/organizacao" className="text-accent underline">
            organização
          </Link>
          .
        </div>
      </AppShell>
    );
  }

  const ehArea = time?.parent_team_id === null;

  return (
    <AppShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {time ? time.name : "Time"}
            {time && (
              // ⚠️ Diz o NÍVEL, porque a tela é a mesma para os dois e o
              // conteúdo muda: numa área aparece todo mundo da árvore; num
              // subtime, só quem está nele e abaixo.
              <Badge tone="outline" size="sm">
                {ehArea ? "Área" : "Subtime"}
              </Badge>
            )}
          </span>
        }
      />

      {erro && <div className="error-box">{erro}</div>}

      {aviso && (
        <div role="status" className="muted mb-4 flex items-start gap-2 text-xs">
          <span>{aviso}</span>
          <button
            className="btn btn-ghost px-1.5 text-xs"
            onClick={() => setAviso(null)}
          >
            Entendi
          </button>
        </div>
      )}

      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : linhas.length === 0 ? (
        <div className="muted">Ninguém neste time ainda.</div>
      ) : (
        // ⚠️ A TABELA É COMPARTILHADA com `/membros` (fatia E). Uma tabela só,
        // uma regra só -- a §5 avisa que duas telas listando pessoas com
        // regras diferentes é o começo do próximo defeito de contador.
        <TabelaDeMembros
          linhas={linhas}
          times={times}
          me={me}
          oferecidos={oferecidos}
          podeMexer={podeMexer}
          colunaDoMeio={{
            titulo: "Cargo aqui",
            render: (l) =>
              l.cargoAqui ? (
                <Badge tone="neutral" size="sm" className="border">
                  {PAPEL[l.cargoAqui]}
                </Badge>
              ) : (
                <span className="muted text-xs">—</span>
              ),
          }}
          onMudou={async (texto) => {
            setAviso(texto);
            await carregar();
          }}
        />
      )}

    </AppShell>
  );
}
