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

/** O que o ator alcanca na gestao de membros. */
export type Alcance =
  /** `team.manage` -- ADMIN/MANAGER. Alcanca o workspace inteiro. */
  | { readonly tipo: "amplo" }
  /**
   * `member.manage.subteam` -- SUPERVISOR. So OPERATOR, e so nos subtimes
   * listados (aqueles onde ELE e supervisor).
   */
  | { readonly tipo: "subtime"; readonly subtimes: readonly string[] }
  /** Sem permissao de gestao: a tela vira somente leitura. */
  | { readonly tipo: "nenhum" };

/** So o que precisamos do usuario autenticado -- facilita testar. */
export type AtorMinimo = {
  permissions: string[];
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
  if (me.permissions.includes("team.manage")) return { tipo: "amplo" };
  if (me.permissions.includes("member.manage.subteam")) {
    return {
      tipo: "subtime",
      subtimes: me.teams
        .filter((t) => t.role === "SUPERVISOR")
        .map((t) => t.team_id),
    };
  }
  return { tipo: "nenhum" };
}

/** True se a tela deve mostrar QUALQUER acao de gestao. */
export function podeGerenciarAlgo(a: Alcance): boolean {
  return a.tipo !== "nenhum";
}

// --------------------------------------------------------------------
// Acoes que a Spec 028 NAO abriu ao supervisor (D3 e D4).
// Todas exigem alcance amplo -- espelham `_assert_gestao_ampla` no backend.
// --------------------------------------------------------------------

/** D3: cadastrar pessoa nova (dispara senha provisoria) e do MANAGER. */
export function podeCadastrarMembro(a: Alcance): boolean {
  return a.tipo === "amplo";
}

/** Resetar senha segue com quem cadastra. */
export function podeResetarSenha(a: Alcance): boolean {
  return a.tipo === "amplo";
}

/** D4: supervisor tira do subtime, mas nunca desativa a conta. */
export function podeDesativarConta(a: Alcance): boolean {
  return a.tipo === "amplo";
}

/** D2: supervisor nao promove ninguem -- trocar papel e do MANAGER. */
export function podeTrocarPapel(a: Alcance): boolean {
  return a.tipo === "amplo";
}

/** Mover entre subtimes toca o subtime de ORIGEM -> fora do alcance (D1). */
export function podeMoverSubtime(a: Alcance): boolean {
  return a.tipo === "amplo";
}

// --------------------------------------------------------------------
// As DUAS acoes que a spec abriu.
// --------------------------------------------------------------------

/**
 * Pode vincular alguem a este time, com este papel?
 *
 * Supervisor: so OPERATOR (D2) e so em subtime proprio (D1).
 */
export function podeAdicionarAoTime(
  a: Alcance,
  teamId: string,
  papel: MemberRole,
): boolean {
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  return papel === "OPERATOR" && a.subtimes.includes(teamId);
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
): boolean {
  if (a.tipo === "amplo") return true;
  if (a.tipo === "nenhum") return false;
  return papelAtual === "OPERATOR" && a.subtimes.includes(teamId);
}

/**
 * Papeis que o ator pode atribuir.
 *
 * ADMIN so aparece para ADMIN (gate D2 da Spec 014, ja existente).
 * Supervisor: so OPERATOR (D2 desta spec).
 */
export function papeisAtribuiveis(
  a: Alcance,
  souAdmin: boolean,
): MemberRole[] {
  if (a.tipo === "nenhum") return [];
  if (a.tipo === "subtime") return ["OPERATOR"];
  return souAdmin
    ? ["ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR"]
    : ["MANAGER", "SUPERVISOR", "OPERATOR"];
}

/**
 * Times que a tela deve oferecer no "adicionar a um time".
 *
 * Amplo: os que a tela ja calculou (a regra 1-subtime do chamador vale).
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
