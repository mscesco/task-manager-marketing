/**
 * A tela `/organizacao` -- Spec 047, fatia B. LOGICA PURA.
 *
 * FRONTEIRA (Spec 027): decisao mora em `lib/`, sem React e sem `fetch`. E
 * aqui isso nao e formalidade: `app/` esta FORA do `include` do vitest, e a
 * Spec 047 §7 diz exatamente isso -- *"`temAcaoPossivel` mora em `lib/`,
 * entao tem guardiao. O resto da tela nao."*
 *
 * ⚠️ E o projeto ja pagou por ignorar isso duas vezes: `candidatosParaAdicionar`
 * (Spec 044) e `computeLens`, que decidia o menu inteiro sem um teste sequer
 * e deixou passar a regressao de 09/09 ate a Camila ver na tela.
 *
 * O que esta tela responde:
 *   - quantas pessoas em cada AREA, e quem a gere
 *   - quem nao esta em area nenhuma (o card que evita gente invisivel)
 *   - onde esta a Fulana (a busca que atravessa as areas)
 */

import type { Member, OrgRole, Team } from "./api";
import type { Permission } from "./permissions.generated";

/** Um card da grade de areas. */
export type AreaCard = {
  readonly area: Team;
  /** Pessoas ATIVAS com vinculo na area OU em qualquer subtime dela. */
  readonly pessoas: number;
  /** Subtimes -- diretos e indiretos. */
  readonly subteams: number;
};

/**
 * A grade de areas, com as contagens que o card mostra.
 *
 * ⚠️⚠️ A CONTAGEM DE PESSOAS VEM DE `member.area_ids`, e NAO de somar o
 * `membros` de cada time da arvore. Somar DUPLICA quem tem vinculo na area e
 * tambem num subtime dela -- e esse e o cadastro normal de quem coordena.
 * O backend ja deduplica (`areas_por_membro`, com `DISTINCT`).
 *
 * ⚠️⚠️ SO ATIVOS -- e ate 10/09 era todo mundo, inclusive inativo. A Camila
 * viu na tela: *"nesse card eu quero que apareca apenas as pessoas ativas no
 * time (...) esta aparecendo o total"*.
 *
 * ⚠️⚠️ E A REGRA E A MESMA DE `subteamCards` (`lib/teamScreen.ts`), DE
 * PROPOSITO. Aquele cartao ja contava so ativos desde 10/09, pelo mesmo
 * motivo: a gaveta do subtime deixou de listar inativo e o numero ficou
 * dizendo outra coisa. Duas contagens de cartao com regras diferentes e o
 * defeito de contador da §3.2 com roupa nova -- so que entre TELAS, onde
 * ninguem compara os dois lado a lado e por isso demora a aparecer.
 *
 * ⚠️ E ISTO NAO CONTRADIZ A §3.2 (o defeito de 27/07). Lá o problema era
 * CABECALHO contra CORPO na mesma tela: o topo dizia 12, a lista mostrava 15.
 * O cartao nao tem corpo -- ele nao lista ninguem, e quem quer a lista abre a
 * area, onde os inativos tem aba propria com o proprio numero. Nada esconde
 * ninguem; o cartao passou a responder "quantas pessoas trabalham aqui".
 *
 * ⚠️ SUBTIME EXCLUIDO NAO CONTA, e nao ha o que fazer para isso: `team` nao
 * tem soft delete (o model so carrega `UUIDPrimaryKeyMixin` e
 * `TimestampMixin`), entao apagar um subtime e um DELETE de verdade -- ele sai
 * da tabela, nao volta na listagem, e nao ha linha para contar. Pergunta da
 * Camila em 10/09.
 */
export function areaCards(
  teams: readonly Team[],
  members: readonly Member[],
): AreaCard[] {
  const areas = teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return areas.map((area) => ({
    area,
    pessoas: members.filter(
      (m) => m.is_active && (m.area_ids ?? []).includes(area.id),
    ).length,
    subteams: descendentes(area.id, teams).size,
  }));
}

/** Subtimes de uma area -- diretos E indiretos (a arvore tem tres niveis). */
function descendentes(areaId: string, teams: readonly Team[]): Set<string> {
  const out = new Set<string>();
  const fila = [areaId];
  let guarda = 0;
  while (fila.length && guarda < 1000) {
    guarda += 1;
    const atual = fila.shift() as string;
    for (const t of teams) {
      if (t.parent_team_id === atual && !out.has(t.id)) {
        out.add(t.id);
        fila.push(t.id);
      }
    }
  }
  return out;
}

/**
 * Quem nao esta em area nenhuma -- o card que impede gente invisivel.
 *
 * ⚠️⚠️ SEM ESTE CARD, quem e cadastrado e nunca alocado NAO APARECE EM LUGAR
 * NENHUM DO PRODUTO, porque a grade e feita de areas. E ele nao e hipotetico:
 * a conta de administracao da Camila esta exatamente assim desde 08/09, de
 * propósito (o passo 2 da Spec 045).
 *
 * ⚠️ USA `area_ids`, e nao `team_ids`. Com `team_ids` (que traz so subteams),
 * todo mundo que esta apenas na area cairia aqui -- inclusive os gerentes.
 */
export function peopleWithoutArea(members: readonly Member[]): Member[] {
  return members
    .filter((m) => (m.area_ids ?? []).length === 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Quem pode ABRIR a tela `/organizacao`? Papel de organizacao (ADMIN ou GESTOR).
 *
 * ⚠️⚠️ Spec 051, fatia F: A TELA ABRIA PARA QUALQUER UM QUE DIGITASSE O
 * ENDERECO. O link do menu so aparecia para papel de organizacao, mas a pagina
 * nao conferia nada -- um operador lia a lista de areas, de gestores e de
 * "pessoas sem area" (as escritas o servidor ja recusava).
 *
 * ⚠️ E ESTA CONDICAO ESTAVA COPIADA EM TRES ARQUIVOS (`AppShell`, `TeamScreen`,
 * `quadro/page`) como `(me.org_role ?? null) !== null`. Uma quarta copia, na
 * pagina, divergiria da primeira na proxima mudanca; as quatro passaram a
 * perguntar aqui.
 *
 * ⚠️ `null`/`undefined` (ainda carregando) e "nao": a pagina espera o `me`
 * antes de decidir, e nao mostra nada ate la.
 */
export function podeAbrirOrganizacao(
  me: { org_role?: OrgRole | null } | null | undefined,
): boolean {
  return (me?.org_role ?? null) !== null;
}

/**
 * Quem administra a ORGANIZACAO -- vai no cabecalho, junto do nome.
 *
 * ⚠️ Gente pouca, e por isso cabe ao lado do nome em vez de virar secao: sao
 * os papeis de organizacao (ADMIN/GESTOR), que existem sem time.
 */
export function organizationManagers(members: readonly Member[]): Member[] {
  return members
    .filter((m) => m.org_role != null)
    .sort((a, b) => {
      // ADMIN primeiro -- quem define a organizacao antes de quem a opera.
      if (a.org_role !== b.org_role) return a.org_role === "ADMIN" ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}

/** Uma pessoa achada pela busca, com as areas em que ela esta. */
/** Só o que a regra abaixo precisa de quem está olhando. */
export type AtorDeOrganizacao = {
  org_role?: OrgRole | null;
  permissions: readonly Permission[];
};

/**
 * Os papéis de organização que o ator pode dar a esta pessoa (Spec 049, fatia G).
 *
 * Devolve a lista de destinos possíveis -- `null` na lista é "tirar da
 * administração" --, ou `null` quando o ator NÃO mexe no papel desta pessoa.
 *
 * ⚠️ O TETO DELA, do Mapa de 10/09: o GESTOR *"traz alguém para gestor e tira
 * de volta"*, e *"só admin promove ou rebaixa admin"*. Duas metades, como no
 * servidor: o gestor não oferece ADMIN como destino, e não mexe em quem já é.
 * Oferecer seria a pílula que a tela mostra e o servidor recusa com 403.
 *
 * ⚠️ NÃO É SEGURANÇA. O servidor confere o mesmo teto em
 * `change_organization_role`; isto só decide o que DESENHAR.
 */
export function papeisDeOrganizacaoAtribuiveis(
  ator: AtorDeOrganizacao,
  papelDoAlvo: OrgRole | null,
): readonly (OrgRole | null)[] | null {
  if (!ator.permissions.includes("org_role.grant")) return null;
  if (ator.org_role === "ADMIN") return ["ADMIN", "GESTOR", null];
  if (papelDoAlvo === "ADMIN") return null;
  return ["GESTOR", null];
}

export type FoundPerson = {
  readonly member: Member;
  readonly areas: Team[];
};

/**
 * A busca por pessoa, ATRAVESSANDO as areas.
 *
 * ⚠️⚠️ NAO E ENFEITE, e a spec diz por que: com N areas e uma pessoa podendo
 * estar em varias, *"onde esta a Fulana?"* nao tem outra resposta nesta tela
 * -- a grade e por AREA, entao ela mostra o agregado e some com o individuo.
 *
 * Casa por nome OU e-mail, sem acento e sem caixa: quem digita "jose" tem de
 * achar "José", e quem digita o comeco do e-mail tambem.
 */
export function searchPeople(
  term: string,
  members: readonly Member[],
  teams: readonly Team[],
): FoundPerson[] {
  if (normalizeText(term) === "") return [];
  return members
    .filter((m) => matchesSearch(term, m))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((member) => ({
      member,
      areas: (member.area_ids ?? [])
        .map((id) => teams.find((t) => t.id === id))
        .filter((t): t is Team => t !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    }));
}

/**
 * A pessoa casa com o term buscado?
 *
 * ⚠️⚠️ AS DUAS TELAS DE PESSOAS PERGUNTAM AQUI, e isso não é organização de
 * código: é a §5 da spec sendo cumprida. Ela avisa que *"duas telas listando
 * pessoas, com regras diferentes, é o começo do próximo defeito de contador"*.
 *
 * E a divergência EXISTIU: a busca da tela de pessoas nasceu com `toLowerCase()`
 * puro enquanto a da `/organizacao` já normalizava acento. Digitar "jose"
 * achava "José" numa tela e ninguém na outra — mesma pessoa, mesmo term,
 * duas respostas. Achado no code review de 09/09.
 *
 * Casa por nome OU e-mail: quem digita o começo do e-mail também precisa
 * achar.
 */
export function matchesSearch(term: string, member: Member): boolean {
  const alvo = normalizeText(term);
  if (alvo === "") return true;
  return (
    normalizeText(member.name).includes(alvo) ||
    normalizeText(member.email).includes(alvo)
  );
}

/**
 * Minuscula e sem acento.
 *
 * ⚠️ `normalize("NFD")` + remocao de diacriticos e a mesma tecnica que o
 * backend usa com `unaccent` na busca do quadro (migration `0015`). As duas
 * pontas precisam concordar, senao a busca da tela acha o que a do servidor
 * nao acha.
 */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
