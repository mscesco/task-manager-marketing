// Spec 055, fatia B -- o histórico virando frase.
//
// O QUE ESTE ARQUIVO PRENDE:
//   - uma frase por tipo de evento (são 11), com os valores que o backend
//     grava de verdade — os exemplos aqui copiam a forma dos construtores em
//     `backend/app/modules/tasks/domain/history.py`;
//   - ⚠️⚠️ AS RESERVAS: pessoa que saiu, coluna apagada, evento antigo sem o
//     campo, tipo que este front não conhece. Nenhuma pode virar string vazia
//     nem id cru na tela — é o que mais vai acontecer, porque a tabela é
//     gravada desde a Entrega 4 e nunca foi lida;
//   - ⚠️ o agrupamento por instante: os eventos de um mesmo gesto viram UMA
//     linha, porque o relógio não os desempata (medido na fatia A).
//
// SABOTAGENS (medidas):
//   A. Em `pessoaDe`, devolver o id quando o nome não resolve. Deve cair
//      "⚠️ pessoa que saiu do workspace não vira uuid na tela".
//   B. Em `agruparPorInstante`, comparar só `quando` (ignorando o autor). Deve
//      cair "⚠️ mesmo instante, pessoas diferentes: dois grupos".

import { describe, expect, it } from "vitest";

import {
  agruparPorInstante,
  fraseDoEvento,
  semParesQueSeAnulam,
  type EventoDeHistorico,
  type NomesDoHistorico,
} from "@/lib/historicoDaTarefa";

const ANA = "u-ana";
const BRUNO = "u-bruno";
const BACKLOG = "c-backlog";
const ANDAMENTO = "c-andamento";

const NOMES: NomesDoHistorico = {
  pessoa: (id) => ({ [ANA]: "Ana Souza", [BRUNO]: "Bruno Lima" })[id] ?? null,
  coluna: (id) =>
    ({ [BACKLOG]: "Backlog", [ANDAMENTO]: "Em Andamento" })[id] ?? null,
};

function evento(over: Partial<EventoDeHistorico> = {}): EventoDeHistorico {
  return {
    id: "h1",
    event_type: "updated",
    field_name: null,
    old_value: null,
    new_value: null,
    event_metadata: null,
    user_id: ANA,
    created_at: "2026-09-30T12:00:00Z",
    ...over,
  };
}

const frase = (over: Partial<EventoDeHistorico>) =>
  fraseDoEvento(evento(over), NOMES);

describe("os eventos da tarefa", () => {
  it("criação distingue tarefa de subtarefa", () => {
    expect(frase({ event_type: "created", event_metadata: { title: "X" } })).toBe(
      "criou a tarefa",
    );
    expect(
      frase({ event_type: "created", event_metadata: { parent_task_id: "t-mae" } }),
    ).toBe("criou a subtarefa");
  });

  it("título mostra o antes e o depois", () => {
    expect(
      frase({
        field_name: "title",
        old_value: { value: "Banner" },
        new_value: { value: "Banner da home" },
      }),
    ).toBe("renomeou de “Banner” para “Banner da home”");
  });

  it("descrição não despeja o texto na linha", () => {
    expect(
      frase({
        field_name: "description",
        old_value: { value: "um texto enorme" },
        new_value: { value: "outro texto enorme" },
      }),
    ).toBe("editou a descrição");
  });

  it("prioridade e status usam os rótulos da tela", () => {
    expect(
      frase({
        field_name: "priority",
        old_value: { value: "LOW" },
        new_value: { value: "URGENT" },
      }),
    ).toBe("mudou a prioridade de Baixa para Urgente");
    expect(
      frase({
        event_type: "status_changed",
        field_name: "status",
        old_value: { value: "BACKLOG" },
        new_value: { value: "COMPLETED" },
      }),
    ).toBe("mudou o status de Backlog para Concluído");
  });

  it("coluna vira nome de coluna", () => {
    expect(
      frase({
        field_name: "column_id",
        old_value: { value: BACKLOG },
        new_value: { value: ANDAMENTO },
      }),
    ).toBe("moveu de Backlog para Em Andamento");
  });

  it("prazo: definir, mudar e tirar são frases diferentes", () => {
    expect(
      frase({ field_name: "due_date", new_value: { value: "2026-08-22" } }),
    ).toBe("definiu o prazo para 22/08");
    expect(
      frase({
        field_name: "due_date",
        old_value: { value: "2026-08-18" },
        new_value: { value: "2026-08-22" },
      }),
    ).toBe("mudou o prazo de 18/08 para 22/08");
    expect(frase({ field_name: "due_date", old_value: { value: "2026-08-18" } })).toBe(
      "tirou o prazo",
    );
  });

  it("responsável e seguidor dizem QUEM", () => {
    expect(
      frase({ event_type: "assigned", event_metadata: { user_id: ANA } }),
    ).toBe("designou Ana Souza");
    expect(
      frase({ event_type: "unassigned", event_metadata: { user_id: BRUNO } }),
    ).toBe("tirou Bruno Lima dos responsáveis");
    expect(
      frase({
        event_type: "watched",
        event_metadata: { target_user_id: ANA, by_self: true },
      }),
    ).toBe("passou a seguir");
    expect(
      frase({
        event_type: "watched",
        event_metadata: { target_user_id: BRUNO, by_self: false },
      }),
    ).toBe("pôs Bruno Lima para seguir");
  });

  it("⚠️ perder o alcance não é 'deixou de seguir'", () => {
    // A pessoa não desistiu: foi tirada porque a tarefa saiu do alcance dela.
    expect(
      frase({
        event_type: "unwatched",
        event_metadata: {
          target_user_id: BRUNO,
          by_self: false,
          reason: "lost_access",
        },
      }),
    ).toBe("Bruno Lima deixou de seguir: perdeu o acesso");
  });

  it("arquivar conta a cascata, e separa o job da pessoa", () => {
    expect(frase({ event_type: "archived" })).toBe("arquivou a tarefa");
    expect(
      frase({ event_type: "archived", event_metadata: { cascade_count: 3 } }),
    ).toBe("arquivou a tarefa e 3 subtarefas");
    expect(
      frase({ event_type: "archived", event_metadata: { cascade_count: 1 } }),
    ).toBe("arquivou a tarefa e 1 subtarefa");
    expect(
      frase({ event_type: "archived", event_metadata: { automated: true } }),
    ).toBe("arquivou automaticamente por inatividade");
    expect(frase({ event_type: "deleted", event_metadata: { cascade_count: 2 } })).toBe(
      "excluiu a tarefa e 2 subtarefas",
    );
  });

  it("mover diz o que mudou de lugar", () => {
    expect(
      frase({
        event_type: "moved",
        event_metadata: { new_parent_task_id: "t-mae" },
      }),
    ).toBe("tornou esta tarefa uma subtarefa");
    expect(
      frase({
        event_type: "moved",
        event_metadata: { old_project_id: "p1" },
      }),
    ).toBe("tirou a tarefa do projeto");
  });
});

describe("⚠️⚠️ as reservas", () => {
  it("⚠️ pessoa que saiu do workspace não vira uuid na tela", () => {
    expect(
      frase({ event_type: "assigned", event_metadata: { user_id: "u-sumiu" } }),
    ).toBe("designou alguém");
  });

  it("coluna apagada encolhe a frase em vez de mostrar o id", () => {
    const f = frase({
      field_name: "column_id",
      old_value: { value: "c-apagada" },
      new_value: { value: ANDAMENTO },
    });
    expect(f).toBe("moveu para Em Andamento");
    expect(f).not.toContain("c-apagada");
  });

  it("evento antigo sem os valores ainda diz alguma coisa", () => {
    // A tabela enche desde a Entrega 4: há linhas de versões antigas dos
    // construtores, sem os campos que a frase gostaria de ter.
    expect(frase({ field_name: "title" })).toBe("renomeou a tarefa");
    expect(frase({ field_name: "column_id" })).toBe("moveu de coluna");
    expect(frase({ event_type: "status_changed", field_name: "status" })).toBe(
      "mudou o status",
    );
  });

  it("⚠️ tipo e campo desconhecidos caem na frase genérica, nunca em vazio", () => {
    expect(frase({ event_type: "inventado_amanha" })).toBe("atualizou a tarefa");
    expect(frase({ field_name: "campo_novo" })).toBe("atualizou a tarefa");
  });

  it("nenhuma frase sai vazia, para nenhum dos 11 tipos", () => {
    const tipos = [
      "created", "updated", "status_changed", "moved", "archived",
      "unarchived", "deleted", "assigned", "unassigned", "watched", "unwatched",
    ];
    for (const t of tipos) {
      expect(frase({ event_type: t }).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("o par que se anula", () => {
  // ⚠️ Do historico real dela (30/09): oito linhas seguidas de "passou a
  // seguir" / "deixou de seguir" da mesma pessoa, alternando em minutos.
  const seguir = (id: string, alvo: string, autor = ANA) =>
    evento({
      id,
      event_type: "watched",
      user_id: autor,
      event_metadata: { target_user_id: alvo, by_self: autor === alvo },
    });
  const parar = (id: string, alvo: string, autor = ANA) =>
    evento({
      id,
      event_type: "unwatched",
      user_id: autor,
      event_metadata: { target_user_id: alvo, by_self: autor === alvo },
    });

  it("⚠️ vizinhos que se anulam somem os DOIS", () => {
    const saida = semParesQueSeAnulam([parar("b", ANA), seguir("a", ANA)]);
    expect(saida).toEqual([]);
  });

  it("some tambem na ordem inversa, e em sequencia", () => {
    const saida = semParesQueSeAnulam([
      seguir("d", ANA),
      parar("c", ANA),
      parar("b", ANA),
      seguir("a", ANA),
    ]);
    expect(saida).toEqual([]);
  });

  it("⚠️ pessoas DIFERENTES nao se anulam", () => {
    // Tirar o Bruno e por a Ana e historia de verdade, e nao ruido.
    const entrada = [parar("b", BRUNO), seguir("a", ANA)];
    expect(semParesQueSeAnulam(entrada)).toEqual(entrada);
  });

  it("⚠️ com outra coisa no meio, os dois ficam", () => {
    const meio = evento({ id: "m", event_type: "archived" });
    const entrada = [parar("c", ANA), meio, seguir("a", ANA)];
    expect(semParesQueSeAnulam(entrada).map((e) => e.id)).toEqual(["c", "m", "a"]);
  });

  it("autores diferentes nao se anulam", () => {
    // "Bruno pos a Ana para seguir" e "a Ana deixou de seguir" sao dois fatos.
    const entrada = [parar("b", ANA, ANA), seguir("a", ANA, BRUNO)];
    expect(semParesQueSeAnulam(entrada)).toEqual(entrada);
  });

  it("o que nao e seguir passa intacto", () => {
    const entrada = [
      evento({ id: "x", event_type: "created" }),
      evento({ id: "y", event_type: "archived" }),
    ];
    expect(semParesQueSeAnulam(entrada)).toEqual(entrada);
  });
});

describe("agrupar por instante", () => {
  const INSTANTE = "2026-09-30T12:00:00Z";
  const DEPOIS = "2026-09-30T12:05:00Z";

  it("⚠️ o mesmo gesto vira UMA linha com duas frases", () => {
    // Criar uma tarefa com responsável grava `created` e `assigned` com o
    // MESMO horário -- `func.now()` é constante na transação.
    const grupos = agruparPorInstante(
      [
        evento({ id: "a", event_type: "created", created_at: INSTANTE }),
        evento({
          id: "b",
          event_type: "assigned",
          event_metadata: { user_id: ANA },
          created_at: INSTANTE,
        }),
      ],
      NOMES,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].frases).toEqual(["criou a tarefa", "designou Ana Souza"]);
    expect(grupos[0].chave).toBe("a");
  });

  it("⚠️ mesmo instante, pessoas diferentes: dois grupos", () => {
    const grupos = agruparPorInstante(
      [
        evento({ id: "a", user_id: ANA, created_at: INSTANTE }),
        evento({ id: "b", user_id: BRUNO, created_at: INSTANTE }),
      ],
      NOMES,
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.autorId)).toEqual([ANA, BRUNO]);
  });

  it("gestos iguais em horários diferentes não se juntam", () => {
    const grupos = agruparPorInstante(
      [
        evento({ id: "a", event_type: "archived", created_at: DEPOIS }),
        evento({ id: "b", event_type: "archived", created_at: INSTANTE }),
      ],
      NOMES,
    );
    expect(grupos).toHaveLength(2);
  });

  it("a ordem recebida é preservada (mais novo primeiro)", () => {
    const grupos = agruparPorInstante(
      [
        evento({ id: "novo", created_at: DEPOIS }),
        evento({ id: "velho", created_at: INSTANTE }),
      ],
      NOMES,
    );
    expect(grupos.map((g) => g.quando)).toEqual([DEPOIS, INSTANTE]);
  });

  it("lista vazia não quebra", () => {
    expect(agruparPorInstante([], NOMES)).toEqual([]);
  });
});
