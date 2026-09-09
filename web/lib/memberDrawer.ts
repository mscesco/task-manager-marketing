/**
 * O painel do membro -- Spec 047, fatia D. LOGICA PURA.
 *
 * ⚠️ O painel existe porque **o cargo mora no VÍNCULO, não na pessoa**:
 * `UNIQUE (user_id, team_id)` dá um cargo por time. "Operador em Mídias,
 * supervisor em SEO" é o caso normal, e uma linha de tabela com um cargo só
 * não consegue nem exibir isso.
 *
 * FRONTEIRA (Spec 027): decisão mora em `lib/` porque `app/` está fora do
 * `include` do vitest.
 */

import type { MemberRole, MemberTeamComCadeado, Team } from "./api";

/** Uma linha do painel: um vínculo, e o que dá para fazer com ele. */
export type DrawerMembership = {
  readonly team: Team;
  readonly role: MemberRole;
  /** Veio do backend (fatia A) — a tela NÃO recalcula. */
  readonly podeEditarCargo: boolean;
  /**
   * O cargo aqui é consequência de mandar na árvore, e não uma escolha.
   *
   * ⚠️ Quando a pessoa tem COMANDO na área, a linha do subtime não é cargo, é
   * ALOCAÇÃO — e pela invariante de nível ela nunca conseguirá repetir o papel
   * da raiz ali. Mostrar um seletor seria oferecer uma escolha que não existe.
   * Foi este detalhe que fez a Camila querer apagar o próprio vínculo,
   * olhando a tela de hoje.
   */
  readonly autoridadeVemDe: Team | null;
  /** É uma ÁREA? Quem monta as opções pergunta `papeisAtribuiveis` com isto. */
  readonly ehArea: boolean;
};

/**
 * ⚠️ QUAIS PAPÉIS OFERECER **NÃO** SE DECIDE AQUI, e a ausência é
 * deliberada: `permissoesMembros.papeisAtribuiveis` já responde isso, e já
 * cruza as duas perguntas -- o NÍVEL (invariante da Spec 045, fatia D) e o
 * ALCANCE de quem está editando (matriz da Spec 016).
 *
 * Reescrever a regra de nível aqui criaria uma segunda cópia dela no front,
 * e as duas divergiriam no primeiro papel novo.
 */

const COMANDO: MemberRole[] = ["ADMIN", "MANAGER"];

/**
 * Monta as linhas do painel a partir dos vínculos e da árvore.
 *
 * ⚠️ MOSTRA TODOS OS VÍNCULOS, inclusive os de áreas que quem olha não
 * administra — é a primeira aplicação concreta de "vê amplo, edita estreito".
 * Um gerente de Marketing vê que a pessoa é operadora no TI e não mexe. Sem
 * isso, saber onde alguém está exigiria abrir área por área, que é exatamente
 * a pergunta que o painel existe para responder.
 */
export function drawerMemberships(
  memberships: readonly MemberTeamComCadeado[],
  teams: readonly Team[],
): DrawerMembership[] {
  const porId = new Map(teams.map((t) => [t.id, t]));

  return memberships
    .map((v): DrawerMembership | null => {
      const team = porId.get(v.team_id);
      if (!team) return null;

      const ehArea = team.parent_team_id === null;
      const raiz = ehArea ? team : raizDe(team, teams);
      // Comando na raiz DAQUELA árvore, vindo de outro vínculo da pessoa.
      const comandoNaRaiz =
        !ehArea && raiz
          ? memberships.find(
              (o) => o.team_id === raiz.id && COMANDO.includes(o.role),
            )
          : undefined;

      return {
        team,
        role: v.role,
        podeEditarCargo: v.can_edit_role,
        autoridadeVemDe: comandoNaRaiz && raiz ? raiz : null,
        ehArea,
      };
    })
    .filter((l): l is DrawerMembership => l !== null)
    .sort((a, b) => {
      // Área primeiro, depois subtimes por nome — a leitura é de cima
      // para baixo na hierarquia.
      const ra = a.team.parent_team_id === null ? 0 : 1;
      const rb = b.team.parent_team_id === null ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.team.name.localeCompare(b.team.name, "pt-BR");
    });
}

function raizDe(team: Team, teams: readonly Team[]): Team | null {
  let atual: Team | undefined = team;
  let guarda = 0;
  while (atual && atual.parent_team_id !== null && guarda < 100) {
    guarda += 1;
    atual = teams.find((t) => t.id === atual!.parent_team_id);
  }
  return atual ?? null;
}

/**
 * O que muda quando alguém recebe este cargo, em uma frase.
 *
 * ⚠️⚠️ ISTO SUBSTITUI O TOGGLE POR PERMISSÃO, e a recusa é registrada: a
 * referência que a Camila trouxe tinha `Create cards` / `Add beneficiaries`
 * como chaves individuais — isso é **RBAC editável entrando pela porta dos
 * fundos**, recusado com motivo em `decisoes.md` §10.1.
 *
 * O que se **escolhe** é o cargo; o que se **mostra** é a consequência.
 *
 * ⚠️ E o texto nomeia o TIME, e não fala em abstrato: "administra os
 * operadores do SEO" diz algo; "tem permissões de supervisor" não diz nada a
 * quem está decidindo.
 */
export function roleConsequence(
  role: MemberRole,
  nomeDoTime: string,
): string {
  switch (role) {
    case "ADMIN":
      return `Enxerga e administra tudo — não só ${nomeDoTime}.`;
    case "MANAGER":
      return `Manda em ${nomeDoTime} e em todos os subtimes dela: administra as pessoas, monta os quadros e tria as solicitações.`;
    case "SUPERVISOR":
      return `Administra os operadores de ${nomeDoTime} e monta o quadro de ${nomeDoTime}.`;
    case "OPERATOR":
      return `Trabalha em ${nomeDoTime}: cria e toca tarefas, sem mexer na estrutura.`;
  }
}
