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
 * As cinco telas que são SUAS, recortadas pelo time via `?time=`.
 *
 * ⚠️⚠️ LISTA EXPLÍCITA, e não "tudo o que não for tela de time". A diferença é
 * o que separa um recorte de uma URL que mente: numa tela que NÃO lê o
 * parâmetro, escrevê-lo produz um endereço que diz o time e não filtra nada.
 * A §4.2 da spec adiou o seletor até a fatia C exatamente por isso. A lista é
 * o que impede o acidente de se repetir: **uma tela nova só entra aqui quando
 * alguém a ensinar a ler o parâmetro.**
 *
 * ⚠️ ELA MORA JUNTO DE `TEAM_PARAM` de propósito. Dois consumidores já
 * dependem dela -- `switcherHref` (para onde o seletor leva) e
 * `teamUrlToWrite` (quando reescrever a URL) -- e o dia em que os dois
 * tiverem listas próprias é o dia em que o seletor manda para uma tela que
 * não reescreve, ou vice-versa.
 */
export const TEAM_PARAM_SCREENS = [
  "/minhas-tarefas",
  "/projetos",
  "/arquivadas",
  "/solicitacoes",
  "/formularios",
] as const;

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
 *   4. o time em que a pessoa TRABALHA (ou, sem vínculo, o primeiro que ela
 *      alcança), como INFERIDO;
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
 * ⚠️⚠️ O ITEM 4 PREFERE `own`, E ISSO CORRIGE UM DEFEITO DA PRÓPRIA SPEC. A
 * §4.5 dizia "o time DA PESSOA, a mesma conta de `peopleEntry`" — e
 * `peopleEntry` recebe `rootsForPerson`, que para quem tem papel de organização
 * devolve TODOS os times. Para a conta da Camila (ADMIN) o primeiro por nome é
 * "Comercial", e ela trabalha no Marketing: a reserva cairia exatamente no
 * defeito que esta spec existe para matar.
 *
 * Então a ordem da reserva é: **o time em que ela trabalha** (`own`, de
 * `ownRootTeams`) e, só se ela não tiver vínculo nenhum — o cadastro de quem
 * administra a organização desde 08/09 —, o primeiro que ela alcança.
 *
 * ⚠️ As duas listas vêm ORDENADAS POR NOME (`rootTeams` ordena), e é por isso
 * que "a primeira" é critério e não sorteio: a ordem da API não é contrato de
 * ninguém, e sem critério estável a pessoa cairia em times diferentes sem ter
 * mudado nada.
 *
 * ⚠️ `own ⊆ reachable`, sempre — quem tem vínculo num time o alcança. A
 * validação do parâmetro usa `reachable`, que é o conjunto maior.
 */
export function activeTeam(
  pathname: string,
  search: string,
  teams: readonly Team[],
  reachable: readonly Team[],
  own: readonly Team[],
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

  const reserva = preferredTeams(reachable, own)[0];
  if (!reserva) return { kind: "none" };
  return { kind: "team", teamId: reserva.id, fromUrl: false };
}

/**
 * Os times da pessoa, na ordem em que o produto deve preferi-los.
 *
 * ⚠️⚠️ ELA EXISTE PARA NÃO SER TRÊS CÓPIAS. A mesma pergunta — *"qual time
 * oferecer quando ninguém escolheu?"* — é feita em três lugares: a reserva do
 * `activeTeam`, o destino do item **Time** do menu (`peopleEntry`) e a entrada
 * do quadro (`entradaDoQuadro`). Escrever `own.length ? own : reachable` nos
 * três seria a quarta cópia de regra de navegação deste projeto, e as três
 * anteriores já divergiram (`rootOf`, duas vezes; a regra de alcance na Spec
 * 034).
 *
 * ⚠️ ONDE ELA TRABALHA PRIMEIRO, e só depois o que ela alcança. Para quem tem
 * papel de organização as duas listas diferem muito: `reachable` são todos os
 * times, `own` é onde ela tem vínculo. Preferir `reachable` é o defeito 3.1 —
 * "entrar no sistema abre o Comercial".
 *
 * ⚠️ E O RESTO VEM DEPOIS, em vez de ser descartado: quem alcança dois times e
 * trabalha num só ainda pode navegar para o outro, e a lista completa é o que
 * permite a `entradaDoQuadro` distinguir "tem uma só, desenha" de "tem várias,
 * redireciona".
 */
export function preferredTeams(
  reachable: readonly Team[],
  own: readonly Team[],
): Team[] {
  const idsProprios = new Set(own.map((t) => t.id));
  return [...own, ...reachable.filter((t) => !idsProprios.has(t.id))];
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

/**
 * A URL que a tela deve REESCREVER para carregar o time, ou `null`.
 *
 * ⚠️⚠️ É O QUE FAZ `fromUrl: false` VALER ALGO (§4.1). Sem a reescrita, a
 * pessoa abre "Minhas tarefas", a tela recorta pelo time em que ela trabalha --
 * e a URL não diz isso. Copiar aquele link manda outra pessoa para o time
 * DELA, e o Voltar do navegador volta para um estado sem time. O recorte
 * existiria e seria invisível.
 *
 * ⚠️⚠️ `replace` E NÃO `push`, e isso é decisão e não detalhe: a pessoa não
 * NAVEGOU para cá, a tela só está dizendo onde já estava. Com `push`, o Voltar
 * do navegador cairia na mesma tela sem o parâmetro, que reescreveria de novo --
 * um botão Voltar que não volta.
 *
 * As três razões de devolver `null`:
 *   - a tela não carrega o parâmetro (ver `TEAM_PARAM_SCREENS`) -- escrever ali
 *     é justamente a URL que mente;
 *   - a URL JÁ disse (`fromUrl: true`, ou `?time=tudo`) -- reescrever seria
 *     laço: a query muda, o efeito roda, escreve de novo;
 *   - não há time (`kind: "none"`) -- não há o que dizer.
 *
 * ⚠️ `search` PODE SER `null`, e a distinção é necessária: `null` = a query
 * ainda não foi lida (o `TeamParamReader` ainda não reportou), `""` = lida e
 * vazia. Sem separar as duas, a primeira renderização reescreveria a URL com o
 * time de reserva **por cima de um `?time=` que estava lá** -- link colado
 * apontando para outro time seria sobrescrito antes de ser lido.
 */
export function teamUrlToWrite(
  pathname: string,
  active: ActiveTeam,
  search: string | null,
): string | null {
  if (search === null) return null;
  if (!(TEAM_PARAM_SCREENS as readonly string[]).includes(pathname)) return null;
  if (active.kind !== "team" || active.fromUrl) return null;
  return withTeam(pathname, search, active.teamId);
}
