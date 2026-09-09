"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppShell from "@/components/AppShell";
import Board from "@/components/Board";
import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import AcoesDoQuadro from "@/components/AcoesDoQuadro";
import { currentUser, getRootTeamId, listBoards, type Quadro } from "@/lib/api";
import {
  alcanceDeQuadro,
  podeGerirQuadroDaRaiz,
  resolverQuadroPedido,
  TEXTO_DA_QUEDA,
} from "@/lib/seletorDeQuadro";

// Quadro GERAL: panorama de tudo (sem projectId). A logica do board mora em
// components/Board.tsx, compartilhada com a pagina de projeto (Entrega 11).
//
// ⚠️ ESTA TELA GANHOU SELETOR NA FATIA 5c (18/08), e ate aqui ela era uma
// linha so: `<Board title="Quadro geral" />`. A raiz passou a poder ter quadro
// EXTRA, e sem seletor nao haveria como chegar nele.
//
// ⚠️ A URL JA ESTAVA PRONTA DESDE 13/08, e a decisao esta no `plan.md`: o
// quadro escolhido vive em `?quadro=`, e nao em segmento de rota, porque
// `/quadro/{boardId}` colidiria com `/quadro/{teamId}` -- os dois sao UUID na
// mesma posicao.
function QuadroGeral() {
  // ⚠️ ESTA TELA PASSOU A BUSCAR O `/auth/me` EM 17/08, e o motivo e a 6a-bis:
  // o Quadro geral virou editavel em 13/08 no backend e o lapis nunca apareceu
  // aqui, porque `podeEditarColunas` nao era passado por ninguem.
  //
  // ⚠️ A PERMISSAO VEM DECIDIDA DE FORA, e nao de dentro do `Board` -- mesma
  // regra do `/quadro/[teamId]`. Recalcular no componente seria a segunda
  // definicao da mesma coisa, e as duas divergiriam sem nada ficar vermelho.
  //
  // ⚠️ FALHA = SEM LAPIS, e nao tela de erro. Perder o `/auth/me` nao pode
  // impedir 26 pessoas de ver o quadro por causa de um botao que so ADMIN e
  // MANAGER usam. E o backend recusa com 403 de qualquer forma: isto so evita
  // oferecer.
  const [podeEditar, setPodeEditar] = useState(false);
  useEffect(() => {
    currentUser()
      .then((eu) => setPodeEditar(podeGerirQuadroDaRaiz(alcanceDeQuadro(eu))))
      .catch(() => setPodeEditar(false));
  }, []);

  // ⚠️ `null` = ainda carregando, nos DOIS. Ver `resolverQuadroPedido`: com a
  // lista em `null` ele devolve o pedido SEM conferir e sem avisar, para o
  // aviso de queda nao piscar em todo carregamento.
  const [quadros, setQuadros] = useState<Quadro[] | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);

  const carregarQuadros = useCallback(() => {
    // ⚠️ FALHA EM SILENCIO, com `[]` -- mesma decisao da tela do time. Sem os
    // quadros o seletor mostra so o geral, que e o que esta tela ja era antes
    // desta fatia. Travar tudo porque uma requisicao auxiliar caiu seria pior.
    listBoards()
      .then(setQuadros)
      .catch(() => setQuadros([]));
  }, []);

  useEffect(() => {
    carregarQuadros();
    getRootTeamId()
      .then(setRootId)
      // ⚠️ Spec 046, fatia 1: `getRootTeamId` levanta quando há mais de uma
      // área. Esta é a rota `/quadro` SEM área na URL -- exatamente a que a
      // fatia 4 vai transformar num redirecionamento para a área da pessoa.
      // Até lá, cair para `null` mantém o comportamento de hoje e o erro fica
      // no console, e não invisível.
      .catch((e) => {
        console.error("/quadro: área indefinida", e);
        setRootId(null);
      });
  }, [carregarQuadros]);

  const router = useRouter();
  const searchParams = useSearchParams();

  // ⚠️ A ESCOLHA VIVE NA URL, e nao em `useState` -- mesma decisao de 13/08
  // registrada na tela do time: F5, link mandado para um colega e o botao
  // Voltar do navegador funcionam sem uma linha a mais.
  //
  // ⚠️ MAS AQUI O `null` SIGNIFICA OUTRA COISA. Na tela do time, `null` e a
  // LENTE; aqui e o QUADRO GERAL, que e um registro de verdade. O `Board` sem
  // `boardId` ja desenha o geral, entao os dois caminhos coincidem -- e por
  // isso `?quadro=<id do geral>` e tratado como "sem parametro" logo abaixo.
  const pedidoCru = searchParams.get("quadro");
  // ⚠️ `?quadro=<id do geral>` E TRATADO COMO "SEM PARAMETRO", E EM SILENCIO.
  // O `resolverQuadroPedido` devolveria `e-o-quadro-geral` -- correto na tela
  // do TIME, onde a lente e o espelho dele, e errado aqui: nesta tela o geral
  // e o destino, nao um desvio. Avisar seria explicar um problema que nao
  // existe, com um texto que fala de lente numa pagina que nao tem lente.
  const pedidoEhOGeral =
    !!pedidoCru && (quadros?.find((q) => q.id === pedidoCru)?.is_default ?? false);
  const pedido = pedidoEhOGeral
    ? { id: null, motivo: null }
    : resolverQuadroPedido(pedidoCru, quadros, rootId ?? "");

  const selecionarQuadro = useCallback(
    (id: string | null) => {
      // ⚠️ O GERAL VOLTA PARA A URL LIMPA. Guardar `?quadro=<geral>` daria dois
      // enderecos para a mesma tela, e o segundo cairia no
      // `e-o-quadro-geral` do `resolverQuadroPedido` -- avisando sobre um
      // pedido que a propria tela acabou de fazer.
      const ehGeral = quadros?.find((q) => q.id === id)?.is_default ?? false;
      router.push(
        !id || ehGeral ? "/quadro" : `/quadro?quadro=${encodeURIComponent(id)}`,
      );
    },
    [router, quadros],
  );

  const [quedaDispensada, setQuedaDispensada] = useState<string | null>(null);

  // ⚠️ O SELETOR SO EXISTE COM A RAIZ RESOLVIDA. Sem `rootId` nao ha como
  // filtrar os quadros dela, e desenhar a lista inteira poria o quadro de um
  // subtime na tela do geral.
  const seletor = rootId ? (
    <SeletorDeQuadro
      teamId={rootId}
      quadros={quadros ?? []}
      selecionado={pedido.id}
      podeGerir={podeEditar}
      onSelecionar={selecionarQuadro}
      onMudou={carregarQuadros}
      daRaiz
    />
  ) : (
    "Quadro geral"
  );

  return (
    <AppShell>
      {/* ⚠️ MESMO AVISO DA FATIA 11, e pelo mesmo motivo: com quadro extra da
          raiz existindo, um `?quadro=` pode morrer entre duas pessoas. */}
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

      <Board
        // ⚠️ SEM `boardId` = O QUADRO GERAL, que e o comportamento de sempre e
        // o de 100% das aberturas desta tela ate a fatia 5c.
        boardId={pedido.id ?? undefined}
        title={seletor}
        podeEditarColunas={podeEditar}
        acoesDoQuadro={
          rootId ? (
            <AcoesDoQuadro
              teamId={rootId}
              quadros={quadros ?? []}
              selecionado={pedido.id}
              podeGerir={podeEditar}
              onSelecionar={selecionarQuadro}
              onMudou={carregarQuadros}
              daRaiz
            />
          ) : null
        }
      />
    </AppShell>
  );
}

/**
 * ⚠️ A FRONTEIRA DE `Suspense` É OBRIGATÓRIA AQUI, E O BUILD FOI QUEM DISSE.
 *
 * Esta rota é ESTÁTICA (`○ /quadro` na saída do `next build`), e `useSearchParams`
 * num componente cliente de rota pré-renderizada faz o build parar com
 * *"missing suspense boundary with useSearchParams"*. A fatia 5c pôs o
 * `?quadro=` aqui e derrubou o portão na primeira execução.
 *
 * ⚠️ E O `npm run dev` NÃO RECLAMA -- o erro aparece só no `next build`. Isso
 * está anotado no `/quadro/[teamId]/page.tsx` desde 13/08, onde a situação é a
 * INVERSA: lá a rota é dinâmica (por causa do `[teamId]`), o build passa sem
 * `Suspense`, e a sabotagem de tirá-lo foi conferida. **As duas rotas usam
 * `useSearchParams` e só uma precisa da fronteira** -- e a diferença não está
 * no código delas, e sim em o Next pré-renderizar uma e não a outra.
 *
 * ⚠️ O `fallback` É O QUE APARECE NO HTML ESTÁTICO, antes de o cliente hidratar.
 * "Carregando…" é o mesmo texto que a tela do time usa, e não uma tela em
 * branco: o Quadro geral é a página que 26 pessoas abrem todo dia.
 */
export default function QuadroPage() {
  return (
    <Suspense fallback={<AppShell><div className="muted">Carregando…</div></AppShell>}>
      <QuadroGeral />
    </Suspense>
  );
}
