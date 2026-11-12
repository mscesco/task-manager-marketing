"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import AcoesDoQuadro from "@/components/AcoesDoQuadro";
import {
  listBoards,
  listTeamsAll,
  currentUser,
  type Quadro,
  type Team,
} from "@/lib/api";
import { computeLens } from "@/lib/lens";
import { rootTeamOf } from "@/lib/rootTeams";
import Loading from "@/components/Loading";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import {
  alcanceDeQuadro,
  podeApagarColunas,
  podeApagarQuadros,
  podeGerirQuadrosDe,
  resolverQuadroPedido,
  TEXTO_DA_QUEDA,
  urlDoQuadro,
} from "@/lib/seletorDeQuadro";

// `/quadro/<teamId>`: time raiz -> quadro geral dele; subtime -> lente
// (compartilhadas da raiz + internas). Id inexistente ou fora da lente
// (`computeLens`) mostra aviso. Rota dinâmica: dispensa `Suspense` para o
// `useSearchParams`; se virar estática, o `next build` quebra.
export default function QuadroSubtimePage() {
  const params = useParams();
  const teamId = typeof params.teamId === "string" ? params.teamId : "";

  const [team, setTeam] = useState<Team | null>(null);

  const [rootTeam, setRootTeam] = useState<string | null>(null);
  useDocumentTitle(team?.name);
  const [temAcesso, setTemAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // `null` em `quadroSelecionado` é a lente (sem registro no banco); carga é `quadros === null`.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  const [podeGerir, setPodeGerir] = useState(false);
  // Apagar tem verbo próprio (ver `podeApagarQuadros`).
  const [apagaQuadros, setApagaQuadros] = useState(false);
  const [apagaColunas, setApagaColunas] = useState(false);

  // O quadro escolhido deriva da URL, sem `useState`. Na raiz, `?quadro=<geral>`
  // vale como "sem parâmetro"; num subtime é queda para a lente e o aviso está certo.
  const router = useRouter();
  const searchParams = useSearchParams();
  const ehRaiz = team !== null && team.parent_team_id === null;
  const pedidoCru = searchParams.get("quadro");
  const pedidoEhOGeral =
    !!pedidoCru &&
    (quadros?.find((q) => q.id === pedidoCru)?.is_default ?? false);
  const pedido =
    ehRaiz && pedidoEhOGeral
      ? { id: null, motivo: null }
      : resolverQuadroPedido(pedidoCru, quadros, teamId);
  const quadroSelecionado = pedido.id;

  // Dispensar guarda o id pedido, não um booleano: outro link morto ainda avisa.
  const [quedaDispensada, setQuedaDispensada] = useState<string | null>(null);

  // Escolher o quadro geral limpa o `?quadro=`: o endereço dele é `/quadro/<time>`.
  const selecionarQuadro = useCallback(
    (id: string | null) => {
      const ehGeral = quadros?.find((q) => q.id === id)?.is_default ?? false;
      router.push(urlDoQuadro(teamId, ehGeral ? null : id));
    },
    [router, teamId, quadros],
  );

  useEffect(() => {
    let vivo = true;
    Promise.all([listTeamsAll(), currentUser()])
      .then(([teams, me]) => {
        if (!vivo) return;
        const alvo = teams.find((t) => t.id === teamId) ?? null;
        setTeam(alvo);
        // Time raiz da URL: vai para todo `Board` desta tela (sem ele o `Board`
        // perguntaria a raiz e levantaria) e é o time ativo da lente.
        setRootTeam(rootTeamOf(teamId, teams));
        const lens = computeLens(
          me.teams,
          teams,
          me.roles,
          rootTeamOf(teamId, teams),
        );
        setTemAcesso(alvo ? lens.visibleTeamIds.has(alvo.id) : false);
        const gere = podeGerirQuadrosDe(alcanceDeQuadro(me), teamId);
        setPodeGerir(gere);
        // Verbo e alcance, sempre: `board.delete` não dá o quadro de outro subtime.
        setApagaQuadros(
          gere && podeApagarQuadros(me.permissions, alvo?.parent_team_id === null),
        );
        setApagaColunas(gere && podeApagarColunas(me.permissions));
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

  // Falha em silêncio: sem a lista, o seletor mostra só a lente.
  const carregarQuadros = useCallback(() => {
    listBoards()
      .then(setQuadros)
      .catch(() => setQuadros([]));
  }, []);

  useEffect(() => {
    carregarQuadros();
  }, [carregarQuadros]);

  // Um seletor só para os dois ramos do `Board`. `team` pode ser null aqui
  // (avaliado antes das guardas), por isso o ternário.
  const seletor = team ? (
    <SeletorDeQuadro
      teamId={team.id}
      quadros={quadros ?? []}
      selecionado={quadroSelecionado}
      podeGerir={podeGerir}
      podeApagar={apagaQuadros}
      onSelecionar={selecionarQuadro}
      onMudou={carregarQuadros}
      // Na raiz não há lente: o quadro geral entra pelo nome.
      daRaiz={team.parent_team_id === null}
    />
  ) : null;

  return (
    <AppShell>
      {carregando ? (
        <Loading />
      ) : !team ? (
        <div className="muted">
          Time não encontrado. Verifique o endereço ou volte ao{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : !temAcesso ? (
        // Fora da lente.
        <div className="muted">
          Você não tem acesso ao quadro deste time. Volte ao{" "}
          <a href="/quadro" className="text-accent underline">
            quadro geral
          </a>
          .
        </div>
      ) : (
        <>
          {/* Aviso de queda para a lente (quadro apagado ou link velho). `status`, não `alert`. */}
          {pedido.motivo && quedaDispensada !== searchParams.get("quadro") && (
            <div
              role="status"
              style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 12, padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                fontSize: 13, color: "var(--text)",
              }}
            >
              <span style={{ flex: 1 }}>{TEXTO_DA_QUEDA[pedido.motivo]}</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12, flexShrink: 0 }}
                onClick={() => setQuedaDispensada(searchParams.get("quadro"))}
              >
                Dispensar
              </button>
            </div>
          )}

          {/* O seletor é o título (vai em `heading`). `subteamId` e `boardId` são
              excludentes: os dois juntos trariam tarefas da raiz para um avulso. */}
          {quadroSelecionado ? (
            <Board
              boardId={quadroSelecionado}
              rootTeamId={rootTeam ?? undefined}
              podeEditarColunas={podeGerir}
              podeApagarColunas={apagaColunas}
              heading={seletor}
              // Renomear/apagar só existe no quadro avulso.
              acoesDoQuadro={
                <AcoesDoQuadro
                  teamId={team.id}
                  quadros={quadros ?? []}
                  selecionado={quadroSelecionado}
                  podeGerir={podeGerir}
                  podeApagar={apagaQuadros}
                  onSelecionar={selecionarQuadro}
                  onMudou={carregarQuadros}
                  // Avulso de time raiz usa a lista da raiz.
                  daRaiz={team.parent_team_id === null}
                />
              }
            />
          ) : team.parent_team_id === null ? (
            // Time raiz -> quadro geral dele. `rootTeamId`, não `subteamId`
            // (que ligaria o modo híbrido contra ele mesmo). `podeGerir` vale para a
            // raiz; `selecionado={null}` resolve para o quadro geral com `daRaiz`.
            <Board
              rootTeamId={team.id}
              heading={seletor}
              podeEditarColunas={podeGerir}
              podeApagarColunas={apagaColunas}
              acoesDoQuadro={
                <AcoesDoQuadro
                  teamId={team.id}
                  quadros={quadros ?? []}
                  selecionado={null}
                  podeGerir={podeGerir}
                  podeApagar={apagaQuadros}
                  onSelecionar={selecionarQuadro}
                  onMudou={carregarQuadros}
                  daRaiz
                />
              }
            />
          ) : (
            // Lente: sem edição e sem registro para renomear ou apagar.
            <Board
              subteamId={team.id}
              rootTeamId={rootTeam ?? undefined}
              heading={seletor}
              podeEditarColunas={false}
              podeApagarColunas={false}
              acoesDoQuadro={null}
            />
          )}
        </>
      )}
    </AppShell>
  );
}
