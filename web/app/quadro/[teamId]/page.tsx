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
import {
  alcanceDeQuadro,
  podeGerirQuadrosDe,
  resolverQuadroPedido,
  TEXTO_DA_QUEDA,
  urlDoQuadro,
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
// ⚠️ SEM FRONTEIRA DE `Suspense` PARA O `useSearchParams`, e isso foi MEDIDO
// em 13/08, nao deduzido. A regra do Next existe -- `useSearchParams` num
// componente cliente exige `Suspense` acima -- mas ela vale para rota que o
// build tenta PRE-RENDERIZAR. Esta e dinamica (`ƒ /quadro/[teamId]`, por causa
// do `[teamId]`), entao o `next build` passa sem ela. Sabotagem conferida:
// tirar o `Suspense` que eu havia posto nao derrubou o build.
//
// ⚠️ NO DIA EM QUE ESTA ROTA VIRAR ESTATICA o build para com "missing suspense
// boundary with useSearchParams", e o `npm run dev` NAO reclama -- o erro
// aparece so no portao.
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
  const [podeGerir, setPodeGerir] = useState(false);

  // ⚠️ A URL E A FONTE UNICA, e por isso aqui NAO ha `useState` do quadro
  // escolhido. Guardar a escolha em estado E na URL daria duas verdades para
  // sincronizar, e o Voltar do navegador seria a primeira a divergir:
  // ele mudaria o endereco e a tela continuaria no quadro anterior.
  // Derivando, Voltar e Avancar funcionam sem uma linha a mais.
  const router = useRouter();
  const searchParams = useSearchParams();
  // ⚠️ A VALIDACAO MORA EM `lib/seletorDeQuadro`, TESTADA. O `include` do
  // vitest e so `lib/**` e `components/**` -- regra escrita dentro de `app/`
  // nasce sem guardiao.
  const pedido = resolverQuadroPedido(
    searchParams.get("quadro"),
    quadros,
    teamId,
  );
  const quadroSelecionado = pedido.id;

  // ⚠️ `push`, E NAO `replace`. Trocar de quadro e navegar: a pessoa espera
  // que Voltar desfaca. O preco e uma entrada de historico por troca, e ele e
  // menor que o do Voltar sair da pagina do time inteira sem desfazer nada.
  // ⚠️ DISPENSAR E POR ID PEDIDO, e nao um booleano. Com um booleano, dispensar
  // uma vez calaria o aviso para QUALQUER quadro seguinte na mesma sessao --
  // a pessoa colaria outro link morto e nao veria nada.
  const [quedaDispensada, setQuedaDispensada] = useState<string | null>(null);

  const selecionarQuadro = useCallback(
    (id: string | null) => router.push(urlDoQuadro(teamId, id)),
    [router, teamId],
  );

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

  // ⚠️ UM SO SELETOR PARA OS DOIS RAMOS DO `Board` (fatia 10). Os dois desenham
  // o MESMO dropdown -- ele e o titulo nos dois casos, e e ele quem sabe se o
  // escolhido e a lente ou um avulso (`opcaoSelecionada`). Duplicar o JSX nos
  // dois ramos faria duas copias que divergiriam no primeiro ajuste.
  //
  // ⚠️ `team` PODE SER NULL AQUI. Os ramos que usam este valor ja estao atras
  // das guardas de `carregando`/`team`/`temAcesso`, mas o `const` e avaliado
  // antes delas -- por isso o ternario, e nao um `team!.id`.
  const seletor = team ? (
    <SeletorDeQuadro
      teamId={team.id}
      quadros={quadros ?? []}
      selecionado={quadroSelecionado}
      podeGerir={podeGerir}
      onSelecionar={selecionarQuadro}
      onMudou={carregarQuadros}
    />
  ) : null;

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
          {/* ---- Aviso da queda para a lente (Spec 036, fatia 11) ----------
              ⚠️ ATE AQUI A QUEDA ERA MUDA, E ERA CERTO ASSIM: link velho ou id
              digitado na mao nao mereciam erro na cara de quem so abriu a tela.
              **A fatia 7 mudou o mundo** -- agora uma pessoa APAGA o quadro que
              a outra tem aberto, e a tela da segunda troca de lugar sozinha.
              Silencio, ali, e indistinguivel de defeito.

              ⚠️ AVISO, E NAO ERRO DE PAGINA. A tela continua util: a lente e um
              lugar legitimo, e o assunto de quem abriu (as tarefas do time)
              esta logo abaixo. Um `error-box` ocupando a tela trocaria um
              problema pequeno por uma parede.

              ⚠️ DISPENSAVEL, e o `role="status"` e nao `alert`: `alert`
              interrompe o leitor de tela, e isto e informacao de contexto --
              nada aconteceu de errado com o que a pessoa esta vendo agora. */}
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

          {/* ⚠️ A LINHA SEPARADA DO SELETOR SAIU NA FATIA 10 (18/08). Ela era
              um `<div style={{ marginBottom: 14 }}>` acima do quadro, e o
              `Board` desenhava o titulo logo abaixo -- duas dobras dizendo a
              mesma coisa. Agora o seletor E o titulo: ele vai na prop
              `title` (que virou `ReactNode`), e o `Board` o desenha dentro do
              proprio `<h1>`.

              ⚠️ O TITULO NAO E MAIS TEXTO, E ISSO APAGOU UMA REGRA QUE ERA
              DAQUI: o `?? \`Quadro · ${team.name}\`` que resolvia o nome do
              quadro avulso saiu, porque quem sabe o nome do quadro escolhido e
              o `opcaoSelecionada` dentro do seletor -- e ele ja o desenhava.
              Manter a resolucao aqui seria uma segunda definicao do mesmo nome,
              e as duas divergiriam no primeiro rename. */}
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
              title={seletor}
              // ⚠️ RENOMEAR E APAGAR SO NO RAMO DO QUADRO AVULSO. No ramo da
              // lente nao ha registro para nenhum dos dois, e o proprio
              // `AcoesDoQuadro` devolve `null` ali -- mas nao passa-lo deixa a
              // ausencia explicita em vez de depender de um `if` dentro do
              // componente.
              acoesDoQuadro={
                <AcoesDoQuadro
                  teamId={team.id}
                  quadros={quadros ?? []}
                  selecionado={quadroSelecionado}
                  podeGerir={podeGerir}
                  onSelecionar={selecionarQuadro}
                  onMudou={carregarQuadros}
                />
              }
            />
          ) : (
            <Board subteamId={team.id} title={seletor} />
          )}
        </>
      )}
    </AppShell>
  );
}
