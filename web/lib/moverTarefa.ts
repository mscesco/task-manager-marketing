/**
 * Spec 062 -- o que o modal "Mover…" oferece e o que ele manda.
 *
 * FRONTEIRA (Spec 027): decisao em `lib/`, funcao pura. O `MoverTarefa.tsx`
 * so desenha. ⚠️ NAO E SEGURANCA: o servidor confere alcance e criacao no
 * destino; aqui so montamos as opcoes e o corpo.
 */

import type { Quadro, Team } from "./api";

/** Um lugar para onde a tarefa pode ir como PRINCIPAL. */
export type Destino = {
  /** Chave estavel do `<select>`: `board_id` ou `board_id:team_id` (lente). */
  readonly chave: string;
  readonly rotulo: string;
  /** O nome da area, para agrupar no `<optgroup>`. */
  readonly area: string;
  readonly board_id: string;
  /** So na lente de subtime; `null` = o time do proprio quadro. */
  readonly team_id: string | null;
};

/**
 * Os destinos, agrupados por area: o Quadro geral, a lente de cada subtime
 * (o Quadro geral com o time do subtime) e os quadros avulsos.
 *
 * ⚠️ SO QUADROS QUE A PESSOA ALCANCA: `quadros` vem de `GET /boards`, que ja
 * corta pela lente. A lente de subtime so aparece se o Quadro geral da area
 * apareceu.
 */
export function destinosDoMover(
  quadros: readonly Quadro[],
  times: readonly Team[],
): Destino[] {
  const porId = new Map(times.map((t) => [t.id, t]));
  const raizDe = (id: string): Team | undefined => {
    let t = porId.get(id);
    const vistos = new Set<string>();
    while (t?.parent_team_id && !vistos.has(t.id)) {
      vistos.add(t.id);
      t = porId.get(t.parent_team_id);
    }
    return t;
  };
  const nome = (id: string) => porId.get(id)?.name ?? "Time";
  const pt = (a: string, b: string) => a.localeCompare(b, "pt-BR");

  const out: Destino[] = [];
  const gerais = quadros
    .filter((q) => q.is_default)
    .slice()
    .sort((a, b) => pt(nome(a.team_id), nome(b.team_id)));
  for (const geral of gerais) {
    const area = nome(geral.team_id);
    out.push({
      chave: geral.id,
      // A area no rotulo: com o `<select>` fechado, o `<optgroup>` nao aparece.
      rotulo: `Quadro geral · ${area}`,
      area,
      board_id: geral.id,
      team_id: null,
    });
    const subtimes = times
      .filter((t) => t.parent_team_id !== null && raizDe(t.id)?.id === geral.team_id)
      .slice()
      .sort((a, b) => pt(a.name, b.name));
    for (const sub of subtimes) {
      out.push({
        chave: `${geral.id}:${sub.id}`,
        rotulo: `Lente · ${sub.name}`,
        area,
        board_id: geral.id,
        team_id: sub.id,
      });
    }
    const avulsos = quadros
      .filter((q) => !q.is_default && raizDe(q.team_id)?.id === geral.team_id)
      .slice()
      .sort((a, b) => pt(a.name, b.name));
    for (const q of avulsos) {
      out.push({
        chave: q.id,
        rotulo: porId.get(q.team_id)?.parent_team_id ? `${q.name} · ${nome(q.team_id)}` : q.name,
        area,
        board_id: q.id,
        team_id: null,
      });
    }
  }
  return out;
}

/**
 * O destino onde a tarefa ESTA hoje -- o modal abre nele. Quadro avulso casa
 * pelo quadro; no Quadro geral, casa a lente do time da tarefa, ou o proprio
 * geral se nao houver lente com aquele time.
 */
export function destinoAtual(
  destinos: readonly Destino[],
  task: { board_id: string; team_id: string | null },
): Destino | null {
  return (
    destinos.find((d) => d.board_id === task.board_id && d.team_id === task.team_id) ??
    destinos.find((d) => d.board_id === task.board_id && d.team_id === null) ??
    null
  );
}

/** Um resultado da busca de "Subtarefa de…". */
export type AchadoDaBusca = {
  id: string;
  title: string;
  team_id: string | null;
  depth: number;
  caminho: string[];
};

/** "Campanha de Natal › Redes sociais › Instagram" -- a decisao 5. */
export function caminhoDoAchado(a: AchadoDaBusca): string {
  return [...a.caminho, a.title].join(" › ");
}

export type ModoDoMover = "principal" | "subtarefa";

export type CorpoDoMover = {
  board_id?: string;
  team_id?: string;
  parent_task_id?: string;
};

/**
 * O corpo do `POST /tasks/{id}/relocate`, ou `null` enquanto falta escolher
 * (subtarefa sem mae escolhida).
 */
export function corpoDoMover(
  destino: Destino,
  modo: ModoDoMover,
  maeId: string | null,
): CorpoDoMover | null {
  if (modo === "subtarefa") return maeId ? { parent_task_id: maeId } : null;
  return destino.team_id
    ? { board_id: destino.board_id, team_id: destino.team_id }
    : { board_id: destino.board_id };
}

export type PreviaDoMover = {
  mudou: boolean;
  subtarefas: number;
  projeto_antes: string | null;
  projeto_depois: string | null;
  saem: { user_id: string; nome: string; tarefas: number }[];
  assume: number;
};

/**
 * As frases da previa, na ordem da spec. Vazio quando nada muda (o botao
 * "Mover" fica desligado e a tela diz por que).
 */
export function frasesDaPrevia(p: PreviaDoMover): string[] {
  if (!p.mudou) return [];
  const frases: string[] = [];
  if (p.subtarefas > 0) {
    frases.push(
      p.subtarefas === 1 ? "Leva junto 1 subtarefa." : `Leva junto ${p.subtarefas} subtarefas.`,
    );
  }
  if (p.projeto_antes && p.projeto_antes !== p.projeto_depois) {
    frases.push(
      p.projeto_depois
        ? `Sai do projeto "${p.projeto_antes}" e entra em "${p.projeto_depois}".`
        : `Fica sem o projeto "${p.projeto_antes}", que é de outro time.`,
    );
  } else if (!p.projeto_antes && p.projeto_depois) {
    frases.push(`Entra no projeto "${p.projeto_depois}".`);
  }
  for (const s of p.saem) {
    frases.push(
      `${s.nome || "Uma pessoa"} não vê o destino e sai de ${
        s.tarefas === 1 ? "1 tarefa" : `${s.tarefas} tarefas`
      } (recebe um aviso).`,
    );
  }
  if (p.assume > 0) {
    frases.push(
      p.assume === 1
        ? "Você vira responsável por 1 tarefa que ficaria sem ninguém."
        : `Você vira responsável por ${p.assume} tarefas que ficariam sem ninguém.`,
    );
  }
  return frases;
}
