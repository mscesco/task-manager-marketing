/**
 * O que o seletor de contexto da barra mostra — Spec 047, revisão de 09/09.
 *
 * FRONTEIRA (Spec 027): decisão mora em `lib/`, porque `app/` e o corpo de um
 * componente não têm guardião. E aqui isso pesa: um erro nesta regra não dá
 * tela vermelha — ele some com um caminho de navegação, ou mostra a alguém uma
 * lista de times que não é a dela.
 *
 * ⚠️⚠️ A REGRA É DA CAMILA, e ela a repetiu duas vezes (19/08 e 09/09):
 *
 *     uma raiz só, e a pessoa não administra a organização
 *         -> RÓTULO. Nome do time, texto simples, sem chevron. Não há para
 *            onde ir, e um item clicável que não leva a lugar nenhum é pior
 *            que um rótulo.
 *
 *     mais de uma raiz, OU administra a organização
 *         -> SELETOR.
 *
 * ⚠️⚠️ SÓ TIMES RAIZ ENTRAM NA LISTA, com todas as letras: *"subtimes não são
 * para aparecer ali, só times raiz e a opção de gerenciar a organização"*. O
 * seletor responde *"em qual ÁREA eu estou"*; subtime é navegação DENTRO da
 * área, e o lugar dela é a própria tela do time.
 */

import type { CurrentUser, Team } from "./api";
import { rootTeams } from "./areas";

/**
 * As áreas que ESTA pessoa alcança.
 *
 * ⚠️ QUEM ADMINISTRA A ORGANIZAÇÃO VÊ TODAS, e quem não administra vê só as
 * suas. Não é cosmético: para um gestor, "trocar de área" é o trabalho; para
 * um operador do Marketing, ver "TI" na lista é oferecer uma tela que ele abre
 * e não entende — ou pior, que o servidor recusa.
 *
 * ⚠️ E A RAIZ VEM DO VÍNCULO RESOLVIDO NA ÁRVORE, e não do vínculo direto:
 * quem está APENAS num subtime pertence à área dele, e precisa vê-la. Usar só
 * os vínculos diretos deixaria essa pessoa sem contexto nenhum na barra.
 */
export function rootsForPerson(
  teams: readonly Team[],
  me: CurrentUser | null,
  canManageOrg: boolean,
): Team[] {
  const raizes = rootTeams(teams);
  if (canManageOrg) return raizes;
  if (!me) return [];

  const porId = new Map(teams.map((t) => [t.id, t]));
  const minhas = new Set<string>();
  for (const vinculo of me.teams) {
    const raiz = rootOf(vinculo.team_id, porId);
    if (raiz) minhas.add(raiz);
  }
  return raizes.filter((t) => minhas.has(t.id));
}

/**
 * O que o botão da barra MOSTRA, e qual item leva o ✓.
 *
 * ⚠️⚠️ ELE DIZ ONDE VOCÊ ESTÁ, e até 10/09 dizia "Trocar de área" — que é o
 * que se FAZ com ele, não onde se está. A Camila corrigiu: *"não é para ser
 * mostrado 'Trocar de área', mas sim onde ele está no momento. exemplo, eu
 * estou no marketing, então é para aparecer o nome do time, se estiver no
 * gerenciamento da organização, aparecer o nome da organização"*.
 *
 * ⚠️⚠️ DE UM SUBTIME, MOSTRA A ÁREA — sobe até a raiz. O botão responde *"em
 * qual ÁREA eu estou"* (é essa a lista que ele abre), e subtime é navegação
 * dentro dela. Mostrar "SEO" aqui daria um nome que não existe no menu abaixo,
 * e o ✓ não teria onde pousar.
 *
 * ⚠️⚠️ SEM ÁREA NA URL, O NOME DA ORGANIZAÇÃO — decisão dela em 10/09, entre
 * três opções. A alternativa era mostrar a área DA PESSOA em toda tela, e ela
 * mente numa tela como "Minhas tarefas", que atravessa áreas: o nome sugeriria
 * um recorte que a tela não aplica. O nome da organização é verdade em
 * qualquer tela — você está nela, só não numa área.
 *
 * ⚠️ O QUADRO CONTA COMO ÁREA (`/quadro/<id>`), e não é detalhe: é a tela onde
 * se passa o dia, e ela TEM time na URL. Deixá-la de fora faria o contexto
 * desaparecer justamente onde ele é mais verdadeiro.
 *
 * ⚠️ E o `activeRootId` sai daqui junto, e não de comparar `pathname` com
 * `/times/<id>` no componente: com a comparação crua, estar num subtime do
 * Marketing deixava o menu inteiro sem ✓ — o botão diria "Marketing" e a lista
 * não marcaria nada.
 */
export type CurrentContext = {
  /** O que o botão mostra. Nunca vazio. */
  readonly label: string;
  /** Qual área leva o ✓ no menu. `null` = nenhuma (você está na organização). */
  readonly activeRootId: string | null;
};

/** As telas que carregam um time NA URL, e onde ele está no caminho. */
const ROTAS_COM_TIME = ["/times/", "/quadro/"] as const;

export function currentContext(
  pathname: string,
  teams: readonly Team[],
  orgName: string,
): CurrentContext {
  // ⚠️ O fallback existe para o instante ANTES de `getWorkspace()` voltar: sem
  // ele o botão pisca vazio em cada carga de página.
  const organizacao = { label: orgName.trim() || "Organização", activeRootId: null };

  const prefixo = ROTAS_COM_TIME.find((p) => pathname.startsWith(p));
  if (!prefixo) return organizacao;

  // ⚠️ `split` e não regex: `/times/<id>/algo` (uma tela futura, ou um link
  // com barra no fim) tem de resolver para o MESMO time. Uma regex ancorada no
  // fim devolveria "sem área" e o contexto sumiria da barra.
  const id = pathname.slice(prefixo.length).split("/")[0];
  if (!id) return organizacao;

  const porId = new Map(teams.map((t) => [t.id, t]));
  const raiz = rootOf(id, porId);
  const time = raiz ? porId.get(raiz) : undefined;
  // ⚠️ Time desconhecido (lista ainda carregando, ou id inválido na URL) cai na
  // organização em vez de inventar um nome.
  if (!time) return organizacao;
  return { label: time.name, activeRootId: time.id };
}

/** Sobe até a raiz. `guarda` porque ciclo em dados é mais barato que travar. */
function rootOf(teamId: string, porId: Map<string, Team>): string | null {
  let atual = porId.get(teamId);
  let guarda = 0;
  while (atual && atual.parent_team_id !== null && guarda < 50) {
    guarda += 1;
    atual = porId.get(atual.parent_team_id);
  }
  return atual ? atual.id : null;
}

/** O que desenhar na barra. Ver o bloco no topo do arquivo. */
export type ContextChoice =
  /** Nome do time, sem chevron: não há escolha a fazer. */
  | { readonly kind: "label"; readonly team: Team }
  /** O menu, com as áreas e (talvez) "Gerenciar a organização". */
  | {
      readonly kind: "switcher";
      readonly roots: readonly Team[];
      readonly canManageOrg: boolean;
    }
  /** Nada a mostrar — sem área e sem poder na organização. */
  | { readonly kind: "none" };

export function contextChoice(
  teams: readonly Team[],
  me: CurrentUser | null,
  canManageOrg: boolean,
): ContextChoice {
  const roots = rootsForPerson(teams, me, canManageOrg);

  // ⚠️ QUEM ADMINISTRA A ORGANIZAÇÃO SEMPRE VÊ O SELETOR, mesmo com uma área
  // só — porque "Gerenciar a organização" mora nele, e é a ÚNICA porta para
  // aquela tela desde que ela saiu do menu. Virar rótulo aqui esconderia a
  // porta de quem mais precisa dela.
  if (canManageOrg) return { kind: "switcher", roots, canManageOrg: true };

  if (roots.length === 0) return { kind: "none" };
  if (roots.length === 1) return { kind: "label", team: roots[0] };
  return { kind: "switcher", roots, canManageOrg: false };
}

/**
 * Onde a entrada "Membros" do menu deve cair.
 *
 * ⚠️⚠️ ELA LEVA À TELA DE UM TIME, e não a uma tela própria: a Camila foi
 * explícita em 09/09 — *"adorei a tela que tava com o título 'marketing área'
 * (…) aquela tela é a que eu quero que mostre quando eu abrisse o membros"*.
 * Não existe uma "tela de pessoas da organização" separada; existe a tela do
 * time, e "Membros" é um atalho para a área da pessoa.
 *
 * ⚠️ Com VÁRIAS áreas ela redireciona em vez de escolher calada, e o destino é
 * a primeira POR NOME — a mesma regra e o mesmo motivo de `entradaDoQuadro`:
 * a ordem da API não é contrato de ninguém, então sem ordenar a pessoa cairia
 * em áreas diferentes sem ter mudado nada.
 */
export type PeopleEntry =
  | { readonly kind: "team"; readonly teamId: string }
  | { readonly kind: "none" };

export function peopleEntry(roots: readonly Team[]): PeopleEntry {
  if (roots.length === 0) return { kind: "none" };
  return { kind: "team", teamId: roots[0].id };
}
