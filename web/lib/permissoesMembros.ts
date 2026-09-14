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
   * `member.manage.subteam` -- SUPERVISOR. So OPERATOR, e so nos subtimes
   * listados (aqueles onde ELE e supervisor).
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
 * Papeis que o ator pode atribuir NAQUELE TIME.
 *
 * Duas perguntas, e as duas filtram:
 *   quem e o ator   -- supervisor so atribui OPERATOR (D2 da Spec 028);
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
  // Supervisor so alcanca OPERATOR, e OPERATOR cabe nos dois niveis --
  // entao este ramo nao depende do nivel.
  if (a.tipo === "subtime") return ["OPERATOR"];
  // `souAdmin` deixou de escolher a LISTA e passou a nao escolher nada aqui:
  // o unico papel que ele tinha a mais era ADMIN, que saiu do nivel de time.
  // O parametro fica porque o dia em que a tela da organizacao existir ele
  // volta a decidir algo -- e tirar da assinatura agora obrigaria a mexer nos
  // chamadores duas vezes.
  void souAdmin;
  return ehRaiz ? ["MANAGER", "OPERATOR"] : ["SUPERVISOR", "OPERATOR"];
}

/**
 * Times onde a pessoa AINDA NAO esta -- os candidatos de "adicionar".
 *
 * ⚠️⚠️ ESTA FUNCAO EXISTE POR CAUSA DO QUE SAIU DELA. Ate a Spec 044 fatia 3
 * havia um segundo filtro: se a pessoa ja tinha um subtime, nenhum outro era
 * oferecido, porque o backend devolvia 422 (`_assert_one_subteam`). A trava
 * saiu, e a redatora que o negocio precisa em SEO E em Midias Sociais so
 * aparece na tela por causa dessa remocao.
 *
 * ⚠️ Ela morava DENTRO de `app/membros/page.tsx`, e `app/` esta fora do
 * `include` do vitest -- ou seja, a regra de permissao mais delicada da tela
 * nao tinha guardiao nenhum. Mora aqui para ter um: se alguem reintroduzir o
 * filtro de um-subtime, o teste cai.
 *
 * O unico limite que sobra espelha o `UNIQUE (user_id, team_id)` do banco, e
 * serve para nao oferecer um destino que daria 409.
 */
export function candidatosParaAdicionar(
  times: Team[],
  vinculos: { team_id: string }[]
): Team[] {
  const jaEsta = new Set(vinculos.map((v) => v.team_id));
  return times.filter((t) => !jaEsta.has(t.id));
}

/**
 * Times que a tela deve oferecer no "adicionar a um time".
 *
 * Amplo: os que a tela ja calculou (ver `candidatosParaAdicionar`).
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

/**
 * O aviso de REBAIXAMENTO ao mover alguem para o time principal.
 *
 * ⚠️⚠️ ELE EXISTE PORQUE O BACKEND MUDA O PAPEL SEM PERGUNTAR. Desde a Spec
 * 045 (fatia D), `move_member_subteam` rebaixa um SUPERVISOR a OPERATOR ao
 * levar a pessoa para a raiz -- `SUPERVISOR` deixou de existir la, e a
 * decisao (Camila, 08/09) foi rebaixar em vez de recusar.
 *
 * Sem esta frase, a operacao termina com "movido" e a pessoa perde o posto de
 * supervisora sem que ninguem na tela seja informado. O backend deixa rastro
 * em log (`member.role_demoted_on_move`); quem clicou, nao ve log.
 *
 * ⚠️ COMPARA O QUE VOLTOU COM O QUE HAVIA, e nao "se o destino e a raiz". A
 * resposta do endpoint ja carrega o papel gravado, entao a tela nao precisa
 * -- nem deve -- reimplementar a regra de qual papel vira qual: no dia em que
 * o mapa do backend mudar, esta funcao continua certa sozinha.
 *
 * Devolve `null` quando nada mudou, que e o caso normal.
 */
export function avisoDeRebaixamento(
  papelAntes: MemberRole,
  papelDepois: MemberRole,
  nomeDoTime: string,
): string | null {
  if (papelAntes === papelDepois) return null;
  return (
    `Movido para ${nomeDoTime}, e o papel mudou de ` +
    `${ROTULO_DE_PAPEL[papelAntes]} para ${ROTULO_DE_PAPEL[papelDepois]}: ` +
    `supervisor existe apenas em subtimes.`
  );
}

/**
 * Rotulos dos papeis, em portugues.
 *
 * ⚠️ MORA AQUI, e nao so em `app/membros/page.tsx`, porque
 * `avisoDeRebaixamento` precisa deles e `app/` esta fora do `include` do
 * vitest -- a mesma razao pela qual `candidatosParaAdicionar` mudou de casa.
 */
export const ROTULO_DE_PAPEL: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};
