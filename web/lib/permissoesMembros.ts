/**
 * Spec 028 -- quem pode administrar quem, na tela de membros.
 *
 * FRONTEIRA (Spec 027): isto e DECISAO, entao mora em `lib/` -- funcao pura,
 * sem React, testavel. A tela desenha; nao decide. Foi espalhar maquina de
 * estado dentro de componente grande que causou o bug do modal.
 *
 * ESTE ARQUIVO NAO E SEGURANCA. O backend trava de verdade
 * (MemberService._assert_escopo_supervisor). Aqui so evitamos oferecer botao
 * que o servidor vai recusar com 403 -- se divergir, o usuario ve erro em vez
 * de brecha. Ao mudar a regra no backend, mudar aqui junto.
 */

import type { MemberRole, Team } from "./api";
import type { Permission } from "./permissions.generated";

/** O que o ator alcanca na gestao de membros. */
export type Alcance =
  /** `team.manage` -- ADMIN/MANAGER. Alcanca o workspace inteiro. */
  | { readonly tipo: "amplo" }
  /**
   * SUPERVISOR. So nos subtimes listados (aqueles onde ELE e supervisor), e
   * ali vincula, tira e troca cargo de SUPERVISOR e OPERATOR (Spec 049, H).
   */
  | { readonly tipo: "subtime"; readonly subtimes: readonly string[] }
  /** Sem permissao de gestao: a tela vira somente leitura. */
  | { readonly tipo: "nenhum" };

/** So o que precisamos do usuario autenticado -- facilita testar. */
export type AtorMinimo = {
  permissions: Permission[];
  teams: { team_id: string; role: string }[];
};

/**
 * Deriva o alcance a partir do /auth/me.
 *
 * `team.manage` ganha de `member.manage.subteam`: quem tem os dois (nao
 * acontece hoje, mas o mapa de permissoes e uniao de papeis) fica com o
 * alcance maior.
 */
export function alcanceDe(me: AtorMinimo | null | undefined): Alcance {
  if (!me) return { tipo: "nenhum" };
  // ⚠️⚠️ Spec 049, fatia H: "amplo" e quem MOVE entre subtimes
  // (`membership.move`, so comando e organizacao). Ate a H era quem troca cargo
  // (`membership.update`) -- e o supervisor passou a ter esse verbo no proprio
  // subtime, o que o faria virar "amplo" e ganhar botao em todo time.
  if (me.permissions.includes("membership.move")) return { tipo: "amplo" };
  if (me.permissions.includes("membership.create")) {
    return {
      tipo: "subtime",
      subtimes: me.teams
        .filter((t) => t.role === "SUPERVISOR")
        .map((t) => t.team_id),
    };
  }
  return { tipo: "nenhum" };
}

// --------------------------------------------------------------------
// Acoes que a Spec 028 NAO abriu ao supervisor (D3 e D4).
// Todas exigem alcance amplo -- espelham `_assert_gestao_ampla` no backend.
// --------------------------------------------------------------------

/** D3: cadastrar pessoa nova (dispara senha provisoria) e do MANAGER. */
export function podeCadastrarMembro(a: Alcance): boolean {
  return a.tipo === "amplo";
}

// ⚠️⚠️ AQUI MORAVAM `podeResetarSenha` e `podeDesativarConta`, e sairam na
// Spec 051 (fatia E). Respondiam por "alcance amplo", sem olhar a PESSOA -- e
// desde o conserto de 16/09 (#57) a conta respeita o papel do alvo: o gerente
// nao reseta nem desativa outro gerente. A pergunta passou a ter "quem", e a
// tela nao sabe responder "quem" sem refazer a regra do servidor. A gaveta le
// `GET /members/{id}/account-actions`. Nao traga as duas de volta.

/** Mover entre subtimes toca o subtime de ORIGEM -> fora do alcance (D1). */
export function podeMoverSubtime(a: Alcance): boolean {
  return a.tipo === "amplo";
}

// --------------------------------------------------------------------
// As acoes que a spec abriu ao supervisor, no proprio subtime.
// --------------------------------------------------------------------

function ehPapelDeSubtime(papel: MemberRole): boolean {
  return papel === "SUPERVISOR" || papel === "OPERATOR";
}

/**
 * Pode remover este vinculo?
 *
 * `papelAtual` e o papel DAQUELE vinculo, nao o papel geral da pessoa: um
 * OPERATOR na raiz pode ser SUPERVISOR num subtime.
 */
export function podeRemoverDoTime(
  a: Alcance,
  teamId: string,
  papelAtual: MemberRole,
  /**
   * ⚠️ OBRIGATÓRIO desde a Spec 049, fatia D. O ALCANCE diz "onde"; tirar do
   * time tem verbo próprio (`membership.delete`), e o GESTOR -- que tem alcance
   * amplo, porque troca cargo -- NÃO o tem: o Mapa de 10/09 põe `·` na coluna D
   * do vínculo para ele. Sem este parâmetro, "amplo" respondia sim.
   */
  permissoes: readonly Permission[],
): boolean {
  if (!permissoes.includes("membership.delete")) return false;
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  // Fatia H: tira tambem outro SUPERVISOR do proprio subtime.
  return ehPapelDeSubtime(papelAtual) && a.subtimes.includes(teamId);
}

/**
 * Papeis que o ator pode atribuir NAQUELE TIME.
 *
 * Duas perguntas, e as duas filtram:
 *   quem e o ator   -- supervisor so age em subtime (desde a Spec 049, H,
 *                      atribui SUPERVISOR tambem; ate ali, so OPERATOR);
 *   qual e o nivel  -- invariante de nivel (Spec 045, fatia D).
 *
 * ⚠️⚠️ O PARAMETRO `ehRaiz` NASCEU NA SPEC 045, e sem ele esta funcao MENTIA
 * em tres opcoes de uma vez. Ela devolvia `["ADMIN","MANAGER","SUPERVISOR",
 * "OPERATOR"]` para qualquer time, e depois da fatia D o backend recusa:
 *
 *   ADMIN       -- em nivel de time NENHUM (virou papel de organizacao)
 *   MANAGER     -- em subtime
 *   SUPERVISOR  -- na raiz
 *
 * ⚠️ `ADMIN` SUMIU DOS DOIS RAMOS, inclusive para quem e admin. Nao e questao
 * de permissao -- e que o papel nao mora mais em `user_team`. Quem promove um
 * administrador usa a tela da organizacao (Spec 047).
 *
 * ⚠️ E ISTO NAO E COSMETICO. A tela que oferece o que o servidor recusa
 * transforma uma regra em erro de formulario: a pessoa escolhe "Supervisor"
 * no time geral, salva, e leva 409. A Spec 044 ja deixou um caso desses em
 * pe, e este arquivo nao vai deixar o segundo.
 */
export function papeisAtribuiveis(
  a: Alcance,
  souAdmin: boolean,
  ehRaiz: boolean,
): MemberRole[] {
  if (a.tipo === "nenhum") return [];
  // Supervisor so alcanca o proprio subtime: na raiz nao atribui nada, e no
  // subtime oferece os dois papeis que cabem ali (fatia H).
  if (a.tipo === "subtime") return ehRaiz ? [] : ["SUPERVISOR", "OPERATOR"];
  // `souAdmin` deixou de escolher a LISTA e passou a nao escolher nada aqui:
  // o unico papel que ele tinha a mais era ADMIN, que saiu do nivel de time.
  // O parametro fica porque o dia em que a tela da organizacao existir ele
  // volta a decidir algo -- e tirar da assinatura agora obrigaria a mexer nos
  // chamadores duas vezes.
  void souAdmin;
  return ehRaiz ? ["MANAGER", "OPERATOR"] : ["SUPERVISOR", "OPERATOR"];
}

/**
 * Times que a tela deve oferecer no "adicionar a um time".
 *
 * Amplo: os que a tela ja calculou.
 * Supervisor: SO os proprios subtimes -- nunca a raiz, nunca outro subtime.
 */
export function timesParaAdicionar(a: Alcance, times: Team[]): Team[] {
  if (a.tipo === "amplo") return times;
  if (a.tipo === "nenhum") return [];
  return times.filter((t) => a.subtimes.includes(t.id));
}

/**
 * Ha alguma acao possivel sobre este membro?
 *
 * Decide se a LINHA mostra botao -- nunca se ela aparece. A lista exibe o
 * time inteiro para todo mundo: esconder gente faz o contador divergir do
 * corpo e passa a impressao de que a ferramenta perdeu registros.
 *
 * Para o supervisor ha acao quando o membro esta:
 *   - em ALGUM subtime dele     -> pode remover (D1);
 *   - sem subtime, so na raiz   -> pode puxar para o subtime dele.
 * So em subtime ALHEIO nao ha acao: a trava D1 recusa mexer la.
 *
 * ⚠️ `subtimesDoMembro` e o `team_ids` do Member -- o backend so devolve
 * subtime ali, nunca a raiz; lista VAZIA significa "so na raiz".
 *
 * ⚠️⚠️ ERA `subtimeDoMembro: string | null`, UM subtime, e a pergunta era "o
 * subtime dele e um dos meus?". Com a Spec 044 vira "ALGUM subtime dele e um
 * dos meus?" -- e isso MUDA QUEM UM SUPERVISOR PODE ADMINISTRAR, e nao e
 * refactor. Quem esta em SEO e em Midias Sociais passa a ter linha com botao
 * para o supervisor de SEO, que e o comportamento certo: ele administra a
 * pessoa NAQUELE subtime, e o backend (`_assert_escopo_supervisor`) confere o
 * time alvo de cada operacao, um a um.
 *
 * ⚠️ A trava real continua no backend. Esta funcao decide DESENHO -- se a
 * linha mostra botao. Errar aqui oferece um botao que dara 403; nunca abre
 * uma porta.
 */
export function temAcaoPossivel(
  a: Alcance,
  subtimesDoMembro: string[],
): boolean {
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  return (
    subtimesDoMembro.length === 0 ||
    subtimesDoMembro.some((t) => a.subtimes.includes(t))
  );
}
