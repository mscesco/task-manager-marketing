// lib/historicoDaTarefa.ts
// O histórico da tarefa virando frase (Spec 055, fatia B).
//
// ⚠️ O DADO É CRU, E VELHO. `task_history` é gravado desde a Entrega 4 e nunca
// foi lido: há eventos de todas as versões dos construtores lá dentro, de antes
// de a Spec 053 acrescentar `watched`/`unwatched`. Nada aqui pode assumir que o
// evento tem a forma que o backend de HOJE grava.
//
// ⚠️ TODA FRASE TEM RESERVA, e é o que este arquivo mais faz. Quatro coisas
// faltam com frequência:
//   - a PESSOA saiu do workspace ou do alcance -> o id não está no mapa;
//   - a COLUNA foi apagada -> `old_value` aponta para o que não existe;
//   - o EVENTO é antigo e não tem o campo que a frase queria;
//   - o TIPO é desconhecido, porque alguém acrescentou um no backend.
// Em todos, a saída é uma frase genérica que NÃO MENTE ("atualizou a tarefa"),
// nunca um espaço em branco e nunca um id cru na tela.
//
// ⚠️ A FRASE NÃO TRAZ O AUTOR. Quem desenha mostra o nome uma vez por grupo
// (como no comentário), e repetir "Camila" em cada linha de um gesto que ela
// fez de uma vez só é ruído.
//
// ⚠️ `lib/` DECIDE (Spec 027): a frase, o agrupamento e o que fazer quando
// falta dado moram aqui, com teste. O componente só desenha.

import { PRIORITY_LABEL, STATUSES } from "./status";

/** Um evento como a API o devolve (Spec 055, fatia A). */
export type EventoDeHistorico = {
  readonly id: string;
  readonly event_type: string;
  readonly field_name: string | null;
  readonly old_value: Record<string, unknown> | null;
  readonly new_value: Record<string, unknown> | null;
  readonly event_metadata: Record<string, unknown> | null;
  readonly user_id: string;
  readonly created_at: string;
};

/** Como resolver os ids que o evento guarda. Devolver `null` = não sei. */
export type NomesDoHistorico = {
  readonly pessoa: (id: string) => string | null;
  readonly coluna: (id: string) => string | null;
};

/**
 * Os eventos de UM gesto, de UMA pessoa.
 *
 * ⚠️ EXISTE PORQUE O RELÓGIO NÃO DESEMPATA (medido na fatia A): `created_at`
 * vem de `func.now()`, constante na transação, então criar uma tarefa grava
 * `created` e `assigned` com o mesmo horário ao milissegundo. Na lista, a
 * ordem entre eles seria arbitrária — agrupar é dizer a verdade sobre o dado
 * em vez de fingir uma sequência que ele não tem. Decisão dela, 30/09.
 */
export type GrupoDeHistorico = {
  /** `key` do React: o id do primeiro evento do grupo. */
  readonly chave: string;
  readonly autorId: string;
  readonly quando: string;
  readonly frases: readonly string[];
};

const ROTULO_DE_STATUS = new Map(STATUSES.map((s) => [s.key as string, s.label]));

/** `YYYY-MM-DD` -> `DD/MM`. ⚠️ Corta a string: `new Date` leria meia-noite UTC
 * e escorregaria um dia (mesma regra de `lib/prazo.ts`). */
function dia(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/** O `value` de `old_value`/`new_value`, que é como o backend os embrulha. */
function valor(lado: Record<string, unknown> | null): string | null {
  return lado ? texto(lado.value) : null;
}

function meta(e: EventoDeHistorico, chave: string): unknown {
  return e.event_metadata ? e.event_metadata[chave] : undefined;
}

function quantas(e: EventoDeHistorico): string {
  const n = meta(e, "cascade_count");
  if (typeof n !== "number" || n <= 0) return "";
  return n === 1 ? " e 1 subtarefa" : ` e ${n} subtarefas`;
}

function pessoaDe(
  e: EventoDeHistorico,
  chave: string,
  nomes: NomesDoHistorico,
): string {
  const id = texto(meta(e, chave));
  // ⚠️ "alguém", e nunca o id: quem saiu do workspace não vira UUID na tela.
  return (id && nomes.pessoa(id)) || "alguém";
}

/** A frase de um campo que mudou (`updated`). */
function fraseDeCampo(e: EventoDeHistorico, nomes: NomesDoHistorico): string {
  const de = valor(e.old_value);
  const para = valor(e.new_value);

  switch (e.field_name) {
    case "title":
      if (de && para) return `renomeou de “${de}” para “${para}”`;
      if (para) return `renomeou para “${para}”`;
      return "renomeou a tarefa";
    case "description":
      // Sem o texto: descrição inteira na linha do histórico seria uma parede.
      return "editou a descrição";
    case "priority": {
      const antes = de ? PRIORITY_LABEL[de] ?? de : null;
      const depois = para ? PRIORITY_LABEL[para] ?? para : null;
      if (antes && depois) return `mudou a prioridade de ${antes} para ${depois}`;
      if (depois) return `definiu a prioridade como ${depois}`;
      return "mudou a prioridade";
    }
    case "column_id": {
      const antes = de ? nomes.coluna(de) : null;
      const depois = para ? nomes.coluna(para) : null;
      if (antes && depois) return `moveu de ${antes} para ${depois}`;
      // ⚠️ Coluna apagada: o id não resolve, e a frase encolhe em vez de
      // mostrar um uuid.
      if (depois) return `moveu para ${depois}`;
      return "moveu de coluna";
    }
    case "due_date":
    case "start_date": {
      const qual = e.field_name === "due_date" ? "prazo" : "início";
      if (de && para) return `mudou o ${qual} de ${dia(de)} para ${dia(para)}`;
      if (para) return `definiu o ${qual} para ${dia(para)}`;
      if (de) return `tirou o ${qual}`;
      return `mudou o ${qual}`;
    }
    case "team_id":
      // ⚠️ SEM NOME DE TIME: o detalhe da tarefa não carrega a lista de times,
      // e buscá-la só para esta linha seria uma consulta por histórico aberto.
      return "mudou o time da tarefa";
    default:
      return "atualizou a tarefa";
  }
}

/**
 * Um evento em uma frase, SEM o autor (ver o topo).
 *
 * Nunca devolve string vazia: tipo desconhecido cai em "atualizou a tarefa".
 */
export function fraseDoEvento(
  e: EventoDeHistorico,
  nomes: NomesDoHistorico,
): string {
  switch (e.event_type) {
    case "created":
      return texto(meta(e, "parent_task_id"))
        ? "criou a subtarefa"
        : "criou a tarefa";
    case "updated":
      return fraseDeCampo(e, nomes);
    case "status_changed": {
      const de = valor(e.old_value);
      const para = valor(e.new_value);
      const antes = de ? ROTULO_DE_STATUS.get(de) ?? de : null;
      const depois = para ? ROTULO_DE_STATUS.get(para) ?? para : null;
      if (antes && depois) return `mudou o status de ${antes} para ${depois}`;
      if (depois) return `mudou o status para ${depois}`;
      return "mudou o status";
    }
    case "moved": {
      const projetoNovo = texto(meta(e, "new_project_id"));
      const projetoVelho = texto(meta(e, "old_project_id"));
      const paiNovo = texto(meta(e, "new_parent_task_id"));
      const paiVelho = texto(meta(e, "old_parent_task_id"));
      // ⚠️ SEM NOME DE PROJETO NEM DE TAREFA MÃE, pelo mesmo motivo do time: a
      // tela não os tem em mãos. A frase diz O QUE mudou, e a tarefa em si
      // mostra onde ela está agora.
      if (paiNovo && !paiVelho) return "tornou esta tarefa uma subtarefa";
      if (!paiNovo && paiVelho) return "tirou esta tarefa de subtarefa";
      if (projetoNovo && !projetoVelho) return "pôs a tarefa num projeto";
      if (!projetoNovo && projetoVelho) return "tirou a tarefa do projeto";
      if (projetoNovo && projetoVelho && projetoNovo !== projetoVelho)
        return "mudou a tarefa de projeto";
      return "moveu a tarefa";
    }
    case "archived":
      return meta(e, "automated") === true
        ? `arquivou automaticamente por inatividade${quantas(e)}`
        : `arquivou a tarefa${quantas(e)}`;
    case "unarchived":
      return `desarquivou a tarefa${quantas(e)}`;
    case "deleted":
      return `excluiu a tarefa${quantas(e)}`;
    case "assigned":
      return `designou ${pessoaDe(e, "user_id", nomes)}`;
    case "unassigned":
      return `tirou ${pessoaDe(e, "user_id", nomes)} dos responsáveis`;
    case "watched":
      return meta(e, "by_self") === true
        ? "passou a seguir"
        : `pôs ${pessoaDe(e, "target_user_id", nomes)} para seguir`;
    case "unwatched":
      // ⚠️ Perder o alcance NÃO é "deixou de seguir": a pessoa não desistiu,
      // ela foi tirada porque a tarefa saiu do alcance dela (Spec 053).
      if (meta(e, "reason") === "lost_access")
        return `${pessoaDe(e, "target_user_id", nomes)} deixou de seguir: perdeu o acesso`;
      return meta(e, "by_self") === true
        ? "deixou de seguir"
        : `tirou ${pessoaDe(e, "target_user_id", nomes)} de seguir`;
    default:
      // Tipo que este front não conhece -- porque o backend ganhou um novo.
      return "atualizou a tarefa";
  }
}

/**
 * Junta os eventos do MESMO instante e da MESMA pessoa numa linha só.
 *
 * Preserva a ordem recebida (a API devolve mais novo primeiro), e só agrupa
 * eventos VIZINHOS: dois gestos iguais em horários diferentes continuam
 * separados, mesmo que a frase seja idêntica.
 */
export function agruparPorInstante(
  eventos: readonly EventoDeHistorico[],
  nomes: NomesDoHistorico,
): GrupoDeHistorico[] {
  const grupos: GrupoDeHistorico[] = [];
  for (const e of eventos) {
    const ultimo = grupos[grupos.length - 1];
    const frase = fraseDoEvento(e, nomes);
    if (
      ultimo &&
      ultimo.autorId === e.user_id &&
      ultimo.quando === e.created_at
    ) {
      grupos[grupos.length - 1] = {
        ...ultimo,
        frases: [...ultimo.frases, frase],
      };
      continue;
    }
    grupos.push({
      chave: e.id,
      autorId: e.user_id,
      quando: e.created_at,
      frases: [frase],
    });
  }
  return grupos;
}
