/**
 * Em que time a tela está trabalhando — Spec 048, fatia A.
 *
 * FRONTEIRA (Spec 027): decisão mora em `lib/`, sem React e sem `fetch`. E aqui
 * isso é o ponto inteiro da fatia: `app/` está FORA do `include` do vitest, e o
 * projeto já pagou duas vezes por escrever regra de navegação dentro da tela
 * (`candidatosParaAdicionar` na Spec 044, `computeLens` na 047). Um erro nesta
 * função não dá tela vermelha — ele **recorta a tela pelo time errado**, com os
 * quatro portões verdes.
 *
 * ⚠️⚠️ O TIME MORA NA URL, decisão dela: *"área entra na url, pois estarei
 * movendo entre times diferentes"*. É a mesma escolha da Spec 046 §4.4, e pelo
 * mesmo motivo: é o que faz o link compartilhável e o botão Voltar funcionarem
 * — coisas que "time ativo" guardado em estado não dá.
 *
 * ⚠️⚠️ E A FORMA É QUERY (`?time=<id>`), confirmada por ela em 11/09. O
 * argumento não é custo: as duas rotas que já carregam o time no CAMINHO
 * (`/times/<id>` e `/quadro/<id>`) são telas **do** time — o time é o assunto
 * delas. As outras cinco são telas **suas**, recortadas pelo time. A URL passa
 * a dizer essa diferença:
 *
 *     /times/<id>            -> esta tela é DO time
 *     /quadro/<id>           -> este quadro é DO time
 *     /minhas-tarefas?time=  -> esta tela é MINHA, recortada pelo time
 *
 * ⚠️ O PREÇO ESTÁ MEDIDO E É REAL: as cinco telas são rotas ESTÁTICAS no
 * `next build` (`○ /minhas-tarefas`, `○ /projetos`, `○ /arquivadas`,
 * `○ /solicitacoes`, `○ /formularios`, conferido em 10/09), e `useSearchParams`
 * em rota estática **derruba o build** — armadilha registrada duas vezes
 * (`AGENTS.md` §6, Spec 047 §7). Quem consumir isto numa tela precisa da
 * fronteira de `Suspense`. ⚠️ Esta função NÃO usa `useSearchParams`: ela recebe
 * a query como string, justamente para poder ser testada sem React e para a
 * decisão de onde ler ficar com a tela.
 *
 * ⚠️ NADA DE TELA MUDA NESTA FATIA. Ela só cria a resposta, com teste. Quem a
 * consome é a fatia B (a barra) e a C (as cinco telas).
 */

import type { Team } from "./api";
import { rootTeamOf } from "./areas";

/** O nome do parâmetro na URL. Um lugar só — ninguém redigita a string. */
export const TEAM_PARAM = "time";

/**
 * O valor que significa "todos os times".
 *
 * ⚠️ SÓ MINHAS TAREFAS PEDE ISSO, e é decisão dela: aquela tela mantém o filtro
 * `tudo | por time`, porque ela é a única que atravessa times de propósito —
 * *"o time muda com a área; o que é meu, não"*. As outras quatro sempre têm um
 * time; oferecer "tudo" nelas seria desfazer o recorte que a spec veio criar.
 */
export const ALL_TEAMS = "tudo";

/** As rotas que carregam o time no CAMINHO, e onde ele está nele. */
const ROTAS_COM_TIME = ["/times/", "/quadro/"] as const;

/**
 * Em que time a tela está, e se a URL já dizia.
 *
 * `fromUrl: false` é o que manda a tela **reescrever a URL** (`replace`, não
 * `push`): sem isso o link copiado não carrega o contexto, e o Voltar volta
 * para um estado sem time. Ver §4.1 da spec.
 */
export type ActiveTeam =
  /** Um time resolvido. `fromUrl` diz se ele veio de lá ou foi inferido. */
  | { readonly kind: "team"; readonly teamId: string; readonly fromUrl: boolean }
  /** A pessoa pediu todos — só Minhas tarefas oferece. */
  | { readonly kind: "all" }
  /** Sem time na URL e sem vínculo: não há o que recortar. */
  | { readonly kind: "none" };

/**
 * Resolve o time ativo, nesta ordem — e a ordem é a decisão.
 *
 *   1. o time no CAMINHO (`/times/<id>`, `/quadro/<id>`), subindo até a raiz;
 *   2. `?time=tudo`;
 *   3. `?time=<id>`, se for uma raiz que a pessoa alcança;
 *   4. a raiz da própria pessoa (a primeira por nome), como INFERIDA;
 *   5. nada.
 *
 * ⚠️⚠️ O CAMINHO GANHA DO PARÂMETRO, e não é arbitrário: numa tela **do** time,
 * o time é o assunto. Um `/times/<A>?time=<B>` é um link malformado, e honrar o
 * parâmetro ali mostraria o time A com a barra dizendo B.
 *
 * ⚠️⚠️ E O CAMINHO NÃO É VALIDADO CONTRA `reachable`, enquanto o PARÂMETRO É.
 * A assimetria é deliberada:
 *
 *   - no caminho, quem decide acesso é a TELA (e, atrás dela, o servidor). Um
 *     operador que cole a URL de outro time tem de ver a recusa vinda de lá, e
 *     não um recorte silencioso para o time dele;
 *   - no parâmetro, o valor é um FILTRO que o próprio produto escreve. Um id
 *     que a pessoa não alcança só chega ali por link velho — e a resposta certa
 *     para link velho é cair no time da pessoa e reescrever a URL, não desenhar
 *     uma tela vazia sem explicação.
 *
 * ⚠️ `reachable` vem de `rootsForPerson` já ordenado por nome, e é por isso que
 * o item 4 é "a primeira": a ordem da API não é contrato de ninguém, e sem
 * critério estável a pessoa cairia em times diferentes sem ter mudado nada. É a
 * mesma regra de `peopleEntry` e de `entradaDoQuadro`.
 */
export function activeTeam(
  pathname: string,
  search: string,
  teams: readonly Team[],
  reachable: readonly Team[],
): ActiveTeam {
  const doCaminho = teamInPath(pathname, teams);
  if (doCaminho !== null) {
    return { kind: "team", teamId: doCaminho, fromUrl: true };
  }

  // ⚠️ `URLSearchParams` aceita com e sem "?" — a tela passa
  // `window.location.search` ou o que o roteador der, e os dois funcionam.
  const pedido = new URLSearchParams(search).get(TEAM_PARAM);
  if (pedido === ALL_TEAMS) return { kind: "all" };
  if (pedido !== null && reachable.some((t) => t.id === pedido)) {
    return { kind: "team", teamId: pedido, fromUrl: true };
  }

  if (reachable.length === 0) return { kind: "none" };
  return { kind: "team", teamId: reachable[0].id, fromUrl: false };
}

/**
 * O time que está no CAMINHO, resolvido até a raiz. `null` se não houver.
 *
 * ⚠️ `split` e não regex, pelo mesmo motivo de `currentContext`:
 * `/times/<id>/algo` (uma sub-rota futura, ou um link com barra no fim) tem de
 * resolver para o MESMO time. Uma regex ancorada no fim devolveria nada.
 */
function teamInPath(pathname: string, teams: readonly Team[]): string | null {
  const prefixo = ROTAS_COM_TIME.find((p) => pathname.startsWith(p));
  if (!prefixo) return null;
  const id = pathname.slice(prefixo.length).split("/")[0];
  if (!id) return null;
  // ⚠️ Time desconhecido (árvore ainda carregando, ou id inválido) devolve
  // `null` e cai no caminho de reserva, em vez de recortar por um id que não
  // existe. `rootTeamOf` já fecha em silêncio por decisão -- ver o bloco dela.
  return rootTeamOf(id, teams);
}

/**
 * A mesma URL, com outro time.
 *
 * ⚠️⚠️ UMA FUNÇÃO, E NÃO UM TEMPLATE ESPALHADO, pelo mesmo motivo escrito em
 * `urlDoQuadroDeArea`: no dia em que dois lugares montarem a string de jeitos
 * diferentes, a decisão "o time mora na URL" vira mentira em um deles.
 *
 * ⚠️ PRESERVA OS OUTROS PARÂMETROS. A tela do time guarda `?ver=` e `?aba=` na
 * URL (Spec 047), e trocar de time não pode apagar o recorte que a pessoa
 * escolheu — ela perderia a aba de inativos por ter trocado de time.
 *
 * ⚠️ NÃO SERVE PARA AS ROTAS COM TIME NO CAMINHO. Em `/times/<id>` o destino é
 * outro CAMINHO, não outro parâmetro — quem trata isso é o seletor, na fatia B.
 * Chamar aqui produziria `/times/<A>?time=<B>`, que o `activeTeam` ignora de
 * propósito (o caminho ganha), e a URL passaria a mentir sem efeito.
 */
export function withTeam(
  pathname: string,
  search: string,
  value: string,
): string {
  const params = new URLSearchParams(search);
  params.set(TEAM_PARAM, value);
  return `${pathname}?${params.toString()}`;
}
