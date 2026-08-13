"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import {
  listBoards,
  listTeamsAll,
  currentUser,
  type Quadro,
  type Team,
} from "@/lib/api";
import { computeLens } from "@/lib/lens";
import {
  alcanceDeQuadro,
  podeGerirQuadrosDe,
} from "@/lib/seletorDeQuadro";

// Quadro de SUBTIME (Fatia 7a). Le o teamId da URL e passa como subteamId
// pro Board (modo hibrido: compartilhadas da raiz + internas do subtime).
// O titulo mostra o NOME do time, nao o UUID.
//
// Guardas de rota:
//   - id inexistente -> avisa "time nao encontrado".
//   - id da RAIZ      -> avisa que o lugar dela e o quadro geral.
//   - id FORA da lente do usuario -> avisa "sem acesso" em vez de renderizar
//     um quadro (que, por um subtime alheio, viria quase vazio e ainda
//     convidaria a "criar a primeira tarefa" numa area que nao e sua). O dado
//     ja e protegido pelo backend; isto fecha o furo de UX. A lente e a MESMA
//     (computeLens) que monta as sub-abas do menu, entao nenhum link que o
//     usuario ve no AppShell e barrado aqui -- so ids digitados na mao.
export default function QuadroSubtimePage() {
  const params = useParams();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [team, setTeam] = useState<Team | null>(null);
  const [temAcesso, setTemAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // Fatia 5b-6: os quadros deste time, e qual deles a tela desenha.
  //
  // ⚠️ `null` E A LENTE, e nao "ainda nao carregou" -- ela nao tem registro no
  // banco (ADR 0034). O estado de carga e `quadros === null`.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  const [quadroSelecionado, setQuadroSelecionado] = useState<string | null>(null);
  const [podeGerir, setPodeGerir] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([listTeamsAll(), currentUser()])
      .then(([teams, me]) => {
        if (!vivo) return;
        const alvo = teams.find((t) => t.id === teamId) ?? null;
        setTeam(alvo);
        const lens = computeLens(me.teams, teams);
        setTemAcesso(alvo ? lens.visibleTeamIds.has(alvo.id) : false);
        // ⚠️ A DECISAO MORA EM `lib/seletorDeQuadro`, e nao aqui. A tela so
        // guarda a resposta.
        setPodeGerir(podeGerirQuadrosDe(alcanceDeQuadro(me), teamId));
        setCarregando(false);
      })
      .catch(() => {
        if (!vivo) return;
        setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [teamId]);

  // ⚠️ FALHA EM SILENCIO, com `[]`. Sem os quadros o seletor mostra so a
  // lente, que e o que esta tela ja era antes desta fatia -- e o assunto dela
  // continua sendo ver as tarefas do time. Travar a tela inteira porque uma
  // requisicao auxiliar caiu seria pior que esconder um seletor.
  const carregarQuadros = useCallback(() => {
    listBoards()
      .then(setQuadros)
      .catch(() => setQuadros([]));
  }, []);

  useEffect(() => {
    carregarQuadros();
  }, [carregarQuadros]);

  return (
    <AppShell>
      {carregando ? (
        <div className="muted">Carregando…</div>
      ) : !team ? (
        <div className="muted">
          Time não encontrado. Verifique o endereço ou volte ao{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : team.parent_team_id === null ? (
        // e a raiz -> nao e subtime; o quadro geral e o lugar dela.
        <div className="muted">
          Este é o time principal. Use o{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : !temAcesso ? (
        // fora da lente -> nao e um quadro que este usuario deveria abrir.
        <div className="muted">
          Você não tem acesso ao quadro deste time. Volte ao{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <SeletorDeQuadro
              teamId={team.id}
              quadros={quadros ?? []}
              selecionado={quadroSelecionado}
              podeGerir={podeGerir}
              onSelecionar={setQuadroSelecionado}
              onMudou={carregarQuadros}
            />
          </div>
          {/* ⚠️ `subteamId` E `boardId` SAO EXCLUDENTES, e a escolha e o que
              esta tela faz. Com um quadro avulso selecionado, o `Board` deixa
              de ser LENTE (espelho do Quadro geral filtrado por pessoa, ADR
              0034) e passa a desenhar um registro proprio -- passar os dois
              faria o filtro hibrido trazer tarefas da raiz para um quadro que
              nao as contem, e elas cairiam em `foraDaColuna`: contadas e
              invisiveis. */}
          {quadroSelecionado ? (
            <Board
              boardId={quadroSelecionado}
              podeEditarColunas={podeGerir}
              title={`Quadro · ${
                (quadros ?? []).find((q) => q.id === quadroSelecionado)?.name ??
                team.name
              }`}
            />
          ) : (
            <Board subteamId={team.id} title={`Quadro · ${team.name}`} />
          )}
        </>
      )}
    </AppShell>
  );
}
