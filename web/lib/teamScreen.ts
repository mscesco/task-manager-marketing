/**
 * A tela `/times/[id]` -- Spec 047, fatia C. LOGICA PURA.
 *
 * FRONTEIRA (Spec 027): decisao mora em `lib/`, porque `app/` esta fora do
 * `include` do vitest. Nesta fatia isso e critico -- as duas regras mais
 * delicadas da tela (quem aparece, e o que se perde ao desmarcar) sao
 * exatamente as que nao dao erro quando saem erradas.
 *
 * A divisao de trabalho da §4.4, e vale ter em mente ao mexer aqui:
 *
 *     a tabela  mostra
 *     o lapis   define em QUAIS subteams
 *     o painel  define COM QUE CARGO em cada um   (fatia D)
 */

import type { Member, MemberRole, Team } from "./api";

/** Uma cápsula da coluna de subteams: onde a pessoa está, e como. */
export type SubteamChip = {
  readonly team: Team;
  readonly role: MemberRole;
};

/** Uma linha da tabela. */
export type TeamRow = {
  readonly member: Member;
  /** Cargo na PRÓPRIA área/subtime desta tela, se houver vínculo direto. */
  readonly cargoAqui: MemberRole | null;
  /** Subtimes desta árvore em que a pessoa está, com o cargo. */
  readonly subteams: SubteamChip[];
  /** Está em área(s) além desta? Vira o aviso `+1 área`. */
  readonly outrasAreas: number;
};

/** O time + todos os descendentes dele. */
export function teamTree(teamId: string, teams: readonly Team[]): Set<string> {
  const out = new Set<string>([teamId]);
  const fila = [teamId];
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
 * As linhas da tabela: quem tem vínculo NESTE time **ou em qualquer subtime
 * dele**.
 *
 * ⚠️⚠️ O "OU EM QUALQUER SUBTIME" É A REGRA, e não um detalhe: alguém pode
 * estar só no SEO, sem vínculo na área, e **precisa aparecer** — senão vira
 * gente invisível na tela que existe para administrar gente. A spec diz isso
 * com essas palavras na §4.2.
 *
 * ⚠️ E ELA VALE NOS DOIS NÍVEIS. Abrindo um SUBTIME, a árvore é ele + os
 * netos dele; abrindo a ÁREA, é tudo. É a mesma função, e é por isso que a
 * decisão foi "uma tela só que se adapta ao nível" — duas telas divergiriam
 * com o tempo, e separar depois é mais fácil que reunificar.
 *
 * ⚠️ MOSTRA INATIVO TAMBÉM. A §3.2 é explícita: esconder linha já causou o
 * defeito de 27/07, quando o contador do cabeçalho divergiu do corpo. O que
 * varia é o BOTÃO, nunca a presença — e se a tela filtrar, o cabeçalho tem
 * de dizer "12 de 15".
 */
export function teamRows(
  teamId: string,
  teams: readonly Team[],
  members: readonly Member[],
): TeamRow[] {
  const arvore = teamTree(teamId, teams);
  const esteTime = teams.find((t) => t.id === teamId);
  const areaDesteTime = esteTime ? raizDe(esteTime, teams) : null;

  return members
    .map((member): TeamRow | null => {
      const vinculos = member.memberships ?? [];
      const naArvore = vinculos.filter((v) => arvore.has(v.team_id));
      if (naArvore.length === 0) return null;

      const aqui = naArvore.find((v) => v.team_id === teamId) ?? null;
      const subteams = naArvore
        .filter((v) => v.team_id !== teamId)
        .map((v) => ({
          team: teams.find((t) => t.id === v.team_id),
          role: v.role,
        }))
        .filter((c): c is SubteamChip => c.team !== undefined)
        .sort((a, b) => a.team.name.localeCompare(b.team.name, "pt-BR"));

      // ⚠️ `+N área` avisa que a pessoa tem vínculo em OUTRA área, sem
      // poluir a coluna com times que não são desta tela. O detalhe fica no
      // painel (fatia D) -- aqui é só o aviso de que existe mais.
      const outrasAreas = (member.area_ids ?? []).filter(
        (a) => a !== areaDesteTime,
      ).length;

      return { member, cargoAqui: aqui ? aqui.role : null, subteams, outrasAreas };
    })
    .filter((l): l is TeamRow => l !== null)
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "pt-BR"));
}

function raizDe(team: Team, teams: readonly Team[]): string {
  let atual = team;
  let guarda = 0;
  while (atual.parent_team_id !== null && guarda < 100) {
    guarda += 1;
    const pai = teams.find((t) => t.id === atual.parent_team_id);
    if (!pai) break;
    atual = pai;
  }
  return atual.id;
}

/** Um cartão da visão "Subtimes" — Spec 047, redesenho de 09/09. */
export type SubteamCard = {
  readonly team: Team;
  /** Pessoas na árvore DELE (ele + os netos). */
  readonly pessoas: number;
  /** Subtimes dentro dele — a árvore tem três níveis. */
  readonly subteams: number;
};

/**
 * Os cartões da visão "Subtimes" do alternador.
 *
 * ⚠️⚠️ SÓ OS FILHOS DIRETOS, e a escolha é do desenho: o alternador diz
 * *"o que tem DENTRO deste time"*. Listar netos junto misturaria dois níveis
 * numa grade plana, e a pessoa perderia quem é filho de quem — que é
 * exatamente o que ela abriu a tela para ver. O neto aparece ao entrar no
 * filho, e o número no cartão diz que ele existe.
 *
 * ⚠️ A CONTAGEM DEDUPLICA, pelo mesmo motivo de `areaCards`: quem coordena
 * costuma ter vínculo no subtime E num neto dele, e somar o `membros` de cada
 * time da árvore contaria essa pessoa duas vezes. Conta PESSOAS, não vínculos.
 *
 * ⚠️ E conta inativo também (§3.2) — esconder linha já fez o contador do
 * cabeçalho divergir do corpo, em 27/07.
 */
export function subteamCards(
  teamId: string,
  teams: readonly Team[],
  members: readonly Member[],
): SubteamCard[] {
  return teams
    .filter((t) => t.parent_team_id === teamId)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((team) => {
      const arvore = teamTree(team.id, teams);
      return {
        team,
        // ⚠️⚠️ SÓ ATIVOS, e a razão é CONCORDÂNCIA: a gaveta do subtime
        // deixou de listar inativo (`directMembers`, 10/09), e o cartão
        // continuava contando todo mundo. Resultado na tela: *"desenvolvimento
        // aparece somente as 2 pessoas mas no card AINDA está com 3"*.
        //
        // ⚠️ Dois números para a mesma pergunta é o defeito de contador que a
        // §3.2 registra — só que aqui não é cabeçalho contra corpo, é cartão
        // contra gaveta. Quem muda um TEM de mudar o outro.
        pessoas: members.filter(
          (m) =>
            m.is_active &&
            (m.memberships ?? []).some((v) => arvore.has(v.team_id)),
        ).length,
        // `arvore` inclui o próprio time; os subteams são o resto.
        subteams: arvore.size - 1,
      };
    });
}

/** Uma pessoa com vínculo DIRETO num time, e o cargo dela ali. */
export type DirectMember = {
  readonly member: Member;
  readonly role: MemberRole;
};

/**
 * Quem tem vínculo DIRETO neste time — a lista da gaveta do subtime.
 *
 * ⚠️⚠️ DIRETO, e não "na árvore", ao contrário de `teamRows`. A diferença
 * é a pergunta: a TABELA responde *"quem eu administro a partir daqui"* (e aí
 * o neto conta); a GAVETA responde *"quem está neste time"*, e é a lista de
 * onde se tira alguém. Oferecer "Tirar" para quem está só no neto removeria
 * um vínculo que não existe — 404 — ou, pior, o vínculo errado.
 *
 * ⚠️⚠️ E SÓ QUEM ESTÁ ATIVO. Decisão da Camila em 10/09: *"não quero nem que a
 * pessoa apareça aqui se ela está inativa. Os inativos só aparecem na aba de
 * inativos em membros"*.
 *
 * ⚠️ NÃO CONTRADIZ A §3.2 ("esconder linha faz o contador divergir do corpo"),
 * e a diferença é onde cada coisa CONTA. A tabela é o inventário de pessoas:
 * lá esconder inativo faria "8 pessoas" no cabeçalho e 5 linhas no corpo, e
 * ela tem uma ABA para eles. A gaveta é a lista de trabalho de um time — quem
 * está lá para fazer coisa. Quem saiu da empresa não está.
 *
 * ⚠️ E o vínculo continua existindo: ele reaparece na gaveta DA PESSOA, na aba
 * "Inativos", que é de onde se desfaz. Some da lista, não do banco.
 */
export function directMembers(
  teamId: string,
  members: readonly Member[],
): DirectMember[] {
  return members
    .filter((m) => m.is_active)
    .map((member): DirectMember | null => {
      const v = (member.memberships ?? []).find((x) => x.team_id === teamId);
      return v ? { member, role: v.role } : null;
    })
    .filter((m): m is DirectMember => m !== null)
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "pt-BR"));
}

/**
 * Quem a gaveta do subtime oferece em "adicionar member".
 *
 * ⚠️ SÓ QUEM AINDA NÃO ESTÁ, espelhando o `UNIQUE (user_id, team_id)` do
 * banco: oferecer alguém que já está daria 409.
 *
 * ⚠️ E o universo é a lista que a TELA já carregou — as pessoas da árvore
 * daquele time. Cadastrar gente nova dispara senha provisória e é outra ação
 * (D3 da Spec 028); misturar as duas num seletor só faria o "adicionar" às
 * vezes criar uma conta sem avisar.
 *
 * ⚠️⚠️ INATIVO NÃO É CANDIDATO, e a Camila viu isso na tela em 09/09:
 * *"adicionar membro está mostrando pessoas inativas"*. Desativar desliga a
 * pessoa do sistema inteiro (não há rota de reativar — D5 da Spec 028), então
 * pô-la num time é uma escrita que não serve para nada: o vínculo existe e a
 * pessoa continua sem entrar.
 *
 * ⚠️ E ISTO É O CONTRÁRIO da regra da TABELA, de propósito. Lá inativo APARECE
 * (§3.2 — esconder linha já fez o contador divergir do corpo). A diferença é
 * que a tabela INFORMA e o seletor PROPÕE UMA AÇÃO: informar sobre quem saiu é
 * útil; oferecer uma ação sobre quem saiu é oferecer o que não funciona.
 */
export function subteamCandidates(
  teamId: string,
  members: readonly Member[],
): Member[] {
  return members
    .filter((m) => m.is_active)
    .filter((m) => !(m.memberships ?? []).some((v) => v.team_id === teamId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
