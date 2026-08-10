// =====================================================
// lib/erroAlcance.ts -- o 422 da E8 (Spec 037) virando dado de tela
// -----------------------------------------------------
// A F3 da Spec 037 faz `move_member_subteam`, `remove_member_from_team` e
// `change_member_role` recusarem a mudanca quando a pessoa e a UNICA
// responsavel por tarefa NAO-TERMINAL que deixaria de alcancar. O backend
// devolve 422 com a lista ESTRUTURADA (E8):
//
//   { "error": { "code": "validation_error",
//                "message": "...",
//                "details": { "acao": "move_member_subteam",
//                             "user_id": "...",
//                             "tarefas": [ { id, titulo, subtime, coluna,
//                                            team_id } ] } } }
//
// ⚠️ POR QUE A LISTA, E NAO UMA FRASE. Medido em produção em 10/08/2026: 71
// tarefas travariam uma movimentacao hoje, e UMA pessoa carrega 32 delas.
// Uma frase serve para quem tem 1 e e uma parede para quem tem 32 -- e regra
// que vira parede e contornada, nao seguida. O mesmo raciocinio esta no
// comentario de `member_service.py:172`, do lado que ESCREVE a lista.
//
// ⚠️ ESTE MODULO NAO IMPORTA `lib/api.ts` DE PROPOSITO. Ele recebe uma forma
// estrutural (`status`/`message`/`details`), nao a classe `ApiError`. Assim
// ele fica puro: o teste dele nao precisa de `fetch` mockado, e a fronteira
// do `vitest.config.ts` (lib decide, componente desenha) continua de pe.
// =====================================================

/** Uma tarefa que barrou a mudanca. Espelha `TarefaBloqueio` do backend. */
export type TarefaBloqueada = {
  id: string;
  titulo: string;
  /** `null` quando a tarefa nao tem time (avulsa da raiz). */
  subtime: string | null;
  coluna: string | null;
};

/** O 422 da E8, ja em forma de tela. */
export type BloqueioDeAlcance = {
  mensagem: string;
  /** `move_member_subteam` | `remove_member_from_team` | `change_member_role` */
  acao: string | null;
  tarefas: TarefaBloqueada[];
};

/** O que a linha de membro mostra: ou um texto, ou o bloqueio estruturado. */
export type ErroDeLinha = string | BloqueioDeAlcance;

/** Forma minima do erro. Evita depender da classe `ApiError`. */
type ErroBruto = {
  status?: number;
  message?: string;
  details?: Record<string, unknown> | undefined;
};

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Converte um erro de API no bloqueio da E8, ou `null` se nao for um.
 *
 * `null` significa "trate como erro comum" -- o chamador cai na mensagem de
 * texto de sempre. Nunca lanca: erro dentro de tratamento de erro deixa a
 * tela sem nenhuma informacao, que e pior que a frase generica.
 *
 * ⚠️ ITEM SEM `id` E DESCARTADO. Cada linha da lista vira um link para
 * `/tarefa/<id>`; sem id o link e morto, e um link morto num aviso de erro e
 * pior que a ausencia dele. Se NENHUM item sobreviver, devolve `null` --
 * mostrar "3 tarefas" sem conseguir apontar nenhuma nao ajuda ninguem.
 *
 * ⚠️ NAO BASTA `status === 422`. O 422 tambem sai do `_assert_one_subteam`
 * (ADR 0008, "um subtime por usuario") e do schema do Pydantic, e nenhum dos
 * dois traz `details.tarefas`. O que qualifica o bloqueio e a LISTA existir.
 */
export function bloqueioDeAlcance(e: ErroBruto): BloqueioDeAlcance | null {
  if (e?.status !== 422) return null;

  const bruto = e.details?.["tarefas"];
  if (!Array.isArray(bruto) || bruto.length === 0) return null;

  const tarefas: TarefaBloqueada[] = [];
  for (const item of bruto) {
    if (item === null || typeof item !== "object") continue;
    const linha = item as Record<string, unknown>;
    const id = textoOuNulo(linha["id"]);
    if (id === null) continue;
    tarefas.push({
      id,
      titulo: textoOuNulo(linha["titulo"]) ?? "(sem título)",
      subtime: textoOuNulo(linha["subtime"]),
      coluna: textoOuNulo(linha["coluna"]),
    });
  }
  if (tarefas.length === 0) return null;

  return {
    mensagem:
      textoOuNulo(e.message) ??
      "Esta pessoa é a única responsável por tarefas que deixaria de alcançar.",
    acao: textoOuNulo(e.details?.["acao"]),
    tarefas,
  };
}

/**
 * O que dizer no topo do aviso, por acao.
 *
 * Fica aqui, e nao no componente, porque e um MAPA de valor do backend para
 * texto -- decisao, nao desenho (`vitest.config.ts`: "componente nao ganha
 * regra de negocio por ter ganhado teste").
 *
 * ⚠️ `deactivate_member` NAO aparece: pela E7 desligar alguem nunca barra, e
 * inventar um texto para um caso que o backend nao produz cria a impressao
 * de que ele existe.
 */
export function tituloDoBloqueio(acao: string | null): string {
  switch (acao) {
    case "move_member_subteam":
      return "Não dá para mover ainda";
    case "remove_member_from_team":
      return "Não dá para remover do time ainda";
    case "change_member_role":
      return "Não dá para trocar o papel ainda";
    default:
      return "Não dá para concluir ainda";
  }
}
