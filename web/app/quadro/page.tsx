"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import PageTitle from "@/components/PageTitle";
import AcoesDoQuadro from "@/components/AcoesDoQuadro";
import { currentUser, listBoards, listTeamsAll, type Quadro } from "@/lib/api";
import { entradaDoQuadro } from "@/lib/rootTeams";
import { preferredTeams } from "@/lib/activeTeam";
import { ownRootTeams, rootsForPerson } from "@/lib/contextSwitcher";
import { podeAbrirOrganizacao } from "@/lib/organization";
import Loading from "@/components/Loading";
import {
  alcanceDeQuadro,
  podeApagarColunas,
  podeApagarQuadros,
  podeGerirQuadroDaRaiz,
  resolverQuadroPedido,
  TEXTO_DA_QUEDA,
} from "@/lib/seletorDeQuadro";

// `/quadro`: quadro geral do time raiz da pessoa. O quadro escolhido vive em
// `?quadro=` porque `/quadro/{boardId}` colidiria com `/quadro/{teamId}`.
function QuadroGeral() {
  // Permissões decididas aqui, não no `Board`. Falha = sem lápis (o backend recusa de qualquer forma).
  const [podeEditar, setPodeEditar] = useState(false);
  // Apagar tem verbo próprio, e também exige `podeEditar` (verbo = o quê, alcance = onde).
  const [apagaQuadros, setApagaQuadros] = useState(false);
  const [apagaColunas, setApagaColunas] = useState(false);
  useEffect(() => {
    currentUser()
      .then((eu) => {
        const gere = podeGerirQuadroDaRaiz(alcanceDeQuadro(eu));
        setPodeEditar(gere);
        setApagaQuadros(gere && podeApagarQuadros(eu.permissions, true));
        setApagaColunas(gere && podeApagarColunas(eu.permissions));
      })
      .catch(() => {
        setPodeEditar(false);
        setApagaQuadros(false);
        setApagaColunas(false);
      });
  }, []);

  // `null` = carregando. Com a lista em `null`, `resolverQuadroPedido` não confere nem avisa.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  // O `Board` só nasce depois da decisão: sem time raiz ele perguntaria por conta própria e levantaria.
  const [decidido, setDecidido] = useState(false);
  // Declarado antes do efeito que o usa.
  const router = useRouter();

  const carregarQuadros = useCallback(() => {
    // Falha em silêncio: sem a lista, o seletor mostra só o geral.
    listBoards()
      .then(setQuadros)
      .catch(() => setQuadros([]));
  }, []);

  useEffect(() => {
    carregarQuadros();
    // Sem time na URL: com um time raiz desenha, com vários redireciona para
    // `/quadro/<id>`. `replace`, não `push`, para o Voltar não cair num laço.
    Promise.all([listTeamsAll(), currentUser()])
      .then(([times, me]) => {
        // A escolha é de `entradaDoQuadro`; recebe os times da pessoa em ordem de preferência.
        const podeVerOrganizacao = podeAbrirOrganizacao(me);
        const entrada = entradaDoQuadro(
          preferredTeams(
            rootsForPerson(times, me, podeVerOrganizacao),
            ownRootTeams(times, me),
          ),
        );
        if (entrada.tipo === "desenhar") {
          setRootId(entrada.rootId);
          setDecidido(true);
          return;
        }
        if (entrada.tipo === "redirecionar") {
          router.replace(entrada.para);
          return;
        }
        console.error("/quadro: workspace sem nenhum time");
        setRootId(null);
        setDecidido(true);
      })
      .catch((e) => {
        console.error("/quadro: não consegui listar os times", e);
        setRootId(null);
        setDecidido(true);
      });
  }, [carregarQuadros, router]);

  const searchParams = useSearchParams();

  // A escolha vive na URL. Aqui `null` é o quadro geral (na tela do time é a lente).
  const pedidoCru = searchParams.get("quadro");
  // `?quadro=<id do geral>` vale como "sem parâmetro", sem aviso: aqui o geral é o destino.
  const pedidoEhOGeral =
    !!pedidoCru && (quadros?.find((q) => q.id === pedidoCru)?.is_default ?? false);
  const pedido = pedidoEhOGeral
    ? { id: null, motivo: null }
    : resolverQuadroPedido(pedidoCru, quadros, rootId ?? "");

  const selecionarQuadro = useCallback(
    (id: string | null) => {
      // O geral volta para a URL limpa: um endereço por tela.
      const ehGeral = quadros?.find((q) => q.id === id)?.is_default ?? false;
      router.push(
        !id || ehGeral ? "/quadro" : `/quadro?quadro=${encodeURIComponent(id)}`,
      );
    },
    [router, quadros],
  );

  const [quedaDispensada, setQuedaDispensada] = useState<string | null>(null);

  // Sem `rootId` não há como filtrar os quadros da raiz.
  const seletor = rootId ? (
    <SeletorDeQuadro
      teamId={rootId}
      quadros={quadros ?? []}
      selecionado={pedido.id}
      podeGerir={podeEditar}
      podeApagar={apagaQuadros}
      onSelecionar={selecionarQuadro}
      onMudou={carregarQuadros}
      daRaiz
    />
  ) : (
    // Sem raiz não há seletor; o seletor desenha o próprio `<h1>`, então este ramo também.
    <PageTitle>Quadro geral</PageTitle>
  );

  return (
    <AppShell>
      {/* Aviso de `?quadro=` que não existe mais. */}
      {pedido.motivo && quedaDispensada !== searchParams.get("quadro") && (
        <div
          role="status"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            marginBottom: 12, padding: "9px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface-2)",
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

      {!decidido ? (
        <Loading rotulo="Carregando quadro" />
      ) : (
      <Board
        // Sem `boardId` = o quadro geral.
        boardId={pedido.id ?? undefined}
        rootTeamId={rootId ?? undefined}
        heading={seletor}
        podeEditarColunas={podeEditar}
        podeApagarColunas={apagaColunas}
        acoesDoQuadro={
          rootId ? (
            <AcoesDoQuadro
              teamId={rootId}
              quadros={quadros ?? []}
              selecionado={pedido.id}
              podeGerir={podeEditar}
              podeApagar={apagaQuadros}
              onSelecionar={selecionarQuadro}
              onMudou={carregarQuadros}
              daRaiz
            />
          ) : null
        }
      />
      )}
    </AppShell>
  );
}

/**
 * `Suspense` obrigatório: esta rota é estática e `useSearchParams` sem ele
 * derruba o `next build` (o `npm run dev` não reclama).
 */
export default function QuadroPage() {
  return (
    <Suspense fallback={<AppShell><Loading /></AppShell>}>
      <QuadroGeral />
    </Suspense>
  );
}
