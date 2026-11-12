// O histórico da tarefa virando frase. `task_history` tem eventos de todas as
// versões do backend: pessoa fora do mapa, coluna apagada, campo ausente ou
// tipo desconhecido caem numa frase genérica, nunca em branco nem em id cru.
// A frase não traz o autor; quem desenha mostra o nome uma vez por grupo.

import { PRIORITY_LABEL, STATUSES } from "./status";

/** Um evento como a API o devolve. */
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
 * Os eventos de um gesto, de uma pessoa. `created_at` vem de `func.now()`,
 * constante na transação, então eventos do mesmo gesto têm o mesmo horário e
 * não têm ordem entre si.
 */
export type GrupoDeHistorico = {
  /** `key` do React: o id do primeiro evento do grupo. */
  readonly chave: string;
  readonly autorId: string;
  readonly quando: string;
  readonly frases: readonly string[];
};

const ROTULO_DE_STATUS = new Map(STATUSES.map((s) => [s.key as string, s.label]));

/** `YYYY-MM-DD` -> `DD/MM`. Corta a string: `new Date` leria meia-noite UTC
 * e escorregaria um dia. */
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
  // Quem saiu do workspace vira "alguém", nunca UUID.
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
      // Coluna apagada: a frase encolhe em vez de mostrar o id.
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
    case "due_time": {
      // O Postgres devolve TIME como "18:00:00".
      const antes = de?.slice(0, 5);
      const depois = para?.slice(0, 5);
      if (antes && depois) return `mudou a hora do prazo de ${antes} para ${depois}`;
      if (depois) return `definiu a hora do prazo para ${depois}`;
      if (antes) return "tirou a hora do prazo";
      return "mudou a hora do prazo";
    }
    case "team_id":
      // Sem nome: o detalhe da tarefa não carrega a lista de times.
      return "mudou o time da tarefa";
    default:
      return "atualizou a tarefa";
  }
}

/** Um evento em uma frase, sem o autor. Nunca devolve string vazia. */
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
      // Sem nome de projeto nem de tarefa mãe: a tela não os tem em mãos.
      const quadroNovo = texto(meta(e, "new_board_id"));
      const quadroVelho = texto(meta(e, "old_board_id"));
      if (paiNovo && !paiVelho) return `tornou esta tarefa uma subtarefa${quantas(e)}`;
      if (!paiNovo && paiVelho) return `tirou esta tarefa de subtarefa${quantas(e)}`;
      if (paiNovo && paiVelho && paiNovo !== paiVelho)
        return `pôs esta tarefa dentro de outra${quantas(e)}`;
      if (quadroNovo && quadroVelho && quadroNovo !== quadroVelho)
        return `moveu a tarefa${quantas(e)} para outro quadro`;
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
      // Perder o acesso não é desistir de seguir.
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

/** O par seguir/deixar de seguir, para achar quem anula quem. */
const PAR_QUE_SE_ANULA: Record<string, string> = {
  watched: "unwatched",
  unwatched: "watched",
};

/**
 * Tira os pares seguir/deixar de seguir que se anulam: mesma pessoa seguida,
 * mesmo autor e vizinhos na lista. Par partido entre duas páginas sobrevive.
 */
export function semParesQueSeAnulam(
  eventos: readonly EventoDeHistorico[],
): EventoDeHistorico[] {
  const saida: EventoDeHistorico[] = [];
  let i = 0;
  while (i < eventos.length) {
    const atual = eventos[i];
    const seguinte = eventos[i + 1];
    const oposto = PAR_QUE_SE_ANULA[atual.event_type];
    const mesmaPessoa =
      seguinte &&
      atual.user_id === seguinte.user_id &&
      meta(atual, "target_user_id") === meta(seguinte, "target_user_id");
    if (seguinte && oposto === seguinte.event_type && mesmaPessoa) {
      i += 2; // os dois somem
      continue;
    }
    saida.push(atual);
    i += 1;
  }
  return saida;
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
  return grupos.map((g) => ({ ...g, frases: semStatusEspelhado(g.frases) }));
}

/**
 * Tira o "mudou o status" que só repete o "moveu" do mesmo gesto (coluna-ponte
 * grava os dois eventos). Se os nomes diferem, o status fica.
 */
function semStatusEspelhado(frases: readonly string[]): readonly string[] {
  const movimentos = new Set(
    frases
      .filter((f) => f.startsWith("moveu de ") || f.startsWith("moveu para "))
      .map((f) => f.slice("moveu ".length)),
  );
  if (movimentos.size === 0) return frases;
  const destinos = new Set(
    [...movimentos].map((m) => m.slice(m.lastIndexOf("para ") + "para ".length)),
  );
  return frases.filter((f) => {
    if (f.startsWith("mudou o status de ")) {
      return !movimentos.has(f.slice("mudou o status ".length));
    }
    if (f.startsWith("mudou o status para ")) {
      return !destinos.has(f.slice("mudou o status para ".length));
    }
    return true;
  });
}
