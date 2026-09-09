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

/** Os subteams que o seletor do lápis oferece. */
export function offeredSubteams(
  teamId: string,
  teams: readonly Team[],
): Team[] {
  const arvore = teamTree(teamId, teams);
  return teams
    .filter((t) => t.id !== teamId && arvore.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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
        pessoas: members.filter((m) =>
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
 */
export function directMembers(
  teamId: string,
  members: readonly Member[],
): DirectMember[] {
  return members
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
 */
export function subteamCandidates(
  teamId: string,
  members: readonly Member[],
): Member[] {
  return members
    .filter((m) => !(m.memberships ?? []).some((v) => v.team_id === teamId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * O que se PERDE ao desmarcar subteams no seletor.
 *
 * ⚠️⚠️ ESTA É A REGRA QUE NENHUM PORTÃO PEGA, e a §7 da spec diz por quê: o
 * seletor devolve uma lista de ids, e **o cargo que se perde não está nela**.
 * Nenhum teste de corpo nota a ausência de algo que nunca esteve no payload.
 *
 * O caso: a pessoa é supervisora no SEO. Você desmarca SEO sem querer,
 * salva, percebe e remarca — e ela volta como OPERADOR, porque foi assim que
 * a §4.2 definiu o vínculo novo. O cargo sumiu sem ninguém dizer nada.
 *
 * ⚠️ POR ISSO A CONFIRMAÇÃO É SELETIVA, e não "confirma sempre": desmarcar
 * quem já é operador não perde nada, e confirmar ali treina a pessoa a clicar
 * em "sim" sem ler — que é como a confirmação do caso grave também passa
 * despercebida.
 *
 * Devolve as cápsulas cujo cargo se perde. Vazio = pode salvar direto.
 */
export function rolesLostOnUnpick(
  antes: readonly SubteamChip[],
  depoisIds: readonly string[],
): SubteamChip[] {
  const fica = new Set(depoisIds);
  return antes.filter(
    (c) => !fica.has(c.team.id) && c.role !== "OPERATOR",
  );
}

/**
 * A lista que o seletor mostra.
 *
 * ⭐ COPIA A REGRA DE `TaskDetail.tsx:726-730`, e a spec manda copiar com
 * todas as letras: **quem já está marcado nunca some da lista**, mesmo que
 * saia do escopo de quem edita.
 *
 * ⚠️ Sem isso, salvar o seletor removeria em silêncio um vínculo que você não
 * via — e o defeito só apareceria dias depois, quando alguém notasse que
 * perdeu acesso.
 */
export function pickerOptions(
  oferecidos: readonly Team[],
  jaMarcados: readonly SubteamChip[],
): Team[] {
  const vistos = new Set(oferecidos.map((t) => t.id));
  const faltando = jaMarcados
    .filter((c) => !vistos.has(c.team.id))
    .map((c) => c.team);
  return [...oferecidos, ...faltando].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

/**
 * As linhas da tabela da ORGANIZAÇÃO INTEIRA — Spec 047, fatia E.
 *
 * ⚠️⚠️ ELA EXISTE PARA NÃO HAVER DUAS TABELAS DE PESSOAS COM REGRAS
 * DIFERENTES. A §5 da spec deixou a fatia E aberta com esse aviso literal:
 * *"duas telas listando pessoas, com regras diferentes, é o começo do próximo
 * defeito de contador."* A Camila decidiu em 09/09: `/membros` vira a busca
 * da organização — a mesma tabela, sobre todo mundo.
 *
 * ⚠️ MESMO FORMATO DE LINHA da tela de time (`TeamRow`), de propósito: é
 * o que permite as duas telas dividirem o componente da tabela. O que muda é
 * só a coluna do meio — lá é "Cargo aqui", aqui são as ÁREAS.
 *
 * `cargoAqui` é sempre `null`: não há "aqui" quando o recorte é a organização
 * inteira. As cápsulas trazem TODOS os vínculos, com o cargo.
 */
export function organizationRows(
  teams: readonly Team[],
  members: readonly Member[],
): TeamRow[] {
  return members
    .map((member): TeamRow => {
      const capsulas = (member.memberships ?? [])
        .map((v) => ({
          team: teams.find((t) => t.id === v.team_id),
          role: v.role,
        }))
        .filter((c): c is SubteamChip => c.team !== undefined)
        .sort((a, b) => a.team.name.localeCompare(b.team.name, "pt-BR"));

      return {
        member,
        cargoAqui: null,
        subteams: capsulas,
        // ⚠️ Zero: o aviso "+N área" existe para dizer que há vínculo FORA
        // desta tela. Aqui não há fora — a tela é a organização inteira.
        outrasAreas: 0,
      };
    })
    .sort((a, b) => a.member.name.localeCompare(b.member.name, "pt-BR"));
}

/** O que o seletor precisa escrever, e em que ORDEM. */
export type MembershipPlan = {
  readonly adicionar: string[];
  readonly remover: string[];
};

/**
 * Traduz a marcação do seletor em escritas, com a ORDEM que importa.
 *
 * ⚠️⚠️ ADICIONAR VEM ANTES DE REMOVER, e isso é a regra inteira desta função.
 * A primeira versão do seletor removia primeiro, e isso tornava IMPOSSÍVEL
 * trocar o único time de alguém: o backend recusa remover o último vínculo
 * ("ele ficaria sem time"), então desmarcar Marketing e marcar SEO — cujo
 * estado final é perfeitamente válido — batia em 409 antes de o SEO existir.
 *
 * Invertendo, a pessoa passa por um instante com DOIS vínculos em vez de
 * ZERO. Os dois estados são intermediários; a diferença é que um é aceito
 * pelo servidor e o outro não.
 *
 * ⚠️ Não há transação: cada item vira uma requisição. Quem chama tem de
 * assumir que uma falha no meio deixa estado PARCIAL, e recarregar a tela
 * mesmo no erro — senão a tabela passa a mentir sobre o que está no banco.
 */
export function membershipPlan(
  atuais: readonly SubteamChip[],
  marcados: readonly string[],
): MembershipPlan {
  const antes = new Set(atuais.map((c) => c.team.id));
  const depois = new Set(marcados);
  return {
    adicionar: marcados.filter((id) => !antes.has(id)),
    remover: atuais.filter((c) => !depois.has(c.team.id)).map((c) => c.team.id),
  };
}
