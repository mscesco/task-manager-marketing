// =====================================================
// lib/__tests__/erroAlcance.test.ts -- Spec 037, E8, lado do front
// -----------------------------------------------------
// O QUE ESTES TESTES PROTEGEM:
//
//   - que a lista chegue como LISTA, com os CAMPOS. Afirmar so o tamanho e o
//     que deixa a E8 virar "3 tarefas bloquearam" na primeira pressa -- e o
//     numero sozinho nao diz a ninguem o que fazer a seguir;
//   - que 422 SEM lista continue caindo na mensagem de texto. O 422 tambem sai
//     do `_assert_one_subteam` (ADR 0008) e do schema do Pydantic; tratar todo
//     422 como bloqueio de alcance mostraria uma lista vazia no lugar da frase
//     certa;
//   - que item sem `id` seja descartado. Cada linha vira link para
//     `/tarefa/<id>`; link morto num aviso de erro e pior que aviso sem link.
//
// ⚠️ ESTE ARQUIVO NAO MOCKA `fetch`. O parser recebe a forma estrutural do
// erro, nao a classe `ApiError` -- se um dia ele precisar de rede para ser
// testado, virou outra coisa e saiu de `lib/`.
//
// SABOTAGEM (executar antes de commitar):
//     Em `lib/erroAlcance.ts`, apagar o bloco INTEIRO do descarte:
//         const id = textoOuNulo(linha["id"]);
//         if (id === null) continue;
//     e passar `id: String(linha["id"])`.
//     Deve cair `descarta item sem id` (o item entra com id "undefined") e
//     `devolve null quando nenhum item tem id`. Nao deve cair mais nada.
// =====================================================
import { describe, expect, it } from "vitest";

import { bloqueioDeAlcance, tituloDoBloqueio } from "@/lib/erroAlcance";

const UMA_TAREFA = {
  id: "task-1",
  titulo: "Revisar pauta de agosto",
  subtime: "SEO",
  coluna: "Em andamento",
  team_id: "t-seo",
};

function erro(details: Record<string, unknown>, message = "Barrado.") {
  return { status: 422, message, details };
}

describe("bloqueioDeAlcance()", () => {
  it("devolve a lista com todos os campos, nao so a contagem", () => {
    const b = bloqueioDeAlcance(
      erro({ acao: "move_member_subteam", tarefas: [UMA_TAREFA] })
    );

    expect(b).not.toBeNull();
    expect(b!.acao).toBe("move_member_subteam");
    expect(b!.mensagem).toBe("Barrado.");
    expect(b!.tarefas).toEqual([
      {
        id: "task-1",
        titulo: "Revisar pauta de agosto",
        subtime: "SEO",
        coluna: "Em andamento",
      },
    ]);
  });

  it("preserva a ORDEM que o backend mandou", () => {
    const b = bloqueioDeAlcance(
      erro({
        tarefas: [
          { ...UMA_TAREFA, id: "a" },
          { ...UMA_TAREFA, id: "b" },
          { ...UMA_TAREFA, id: "c" },
        ],
      })
    );

    expect(b!.tarefas.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("devolve null para 422 SEM lista (ex.: a regra de 1 subtime, ADR 0008)", () => {
    expect(bloqueioDeAlcance(erro({ field: "team_id" }))).toBeNull();
  });

  it("devolve null para lista VAZIA", () => {
    expect(bloqueioDeAlcance(erro({ tarefas: [] }))).toBeNull();
  });

  it("devolve null quando `tarefas` nao e array", () => {
    expect(bloqueioDeAlcance(erro({ tarefas: "3" }))).toBeNull();
  });

  it("devolve null para status que nao e 422", () => {
    expect(
      bloqueioDeAlcance({
        status: 409,
        message: "Conflito.",
        details: { tarefas: [UMA_TAREFA] },
      })
    ).toBeNull();
  });

  it("devolve null para erro sem details (403, 404, rede)", () => {
    expect(bloqueioDeAlcance({ status: 403, message: "Sem permissão." })).toBeNull();
    expect(bloqueioDeAlcance({})).toBeNull();
  });

  it("descarta item sem id e mantem os demais", () => {
    const b = bloqueioDeAlcance(
      erro({ tarefas: [{ titulo: "Sem id" }, UMA_TAREFA] })
    );

    expect(b!.tarefas).toHaveLength(1);
    expect(b!.tarefas[0].id).toBe("task-1");
  });

  it("devolve null quando NENHUM item tem id", () => {
    expect(
      bloqueioDeAlcance(erro({ tarefas: [{ titulo: "Sem id" }, { titulo: "Outra" }] }))
    ).toBeNull();
  });

  it("aceita subtime e coluna nulos (tarefa avulsa da raiz)", () => {
    const b = bloqueioDeAlcance(
      erro({ tarefas: [{ id: "x", titulo: "Avulsa", subtime: null, coluna: null }] })
    );

    expect(b!.tarefas[0].subtime).toBeNull();
    expect(b!.tarefas[0].coluna).toBeNull();
  });

  it("usa um texto proprio quando o backend nao manda mensagem", () => {
    const b = bloqueioDeAlcance({ status: 422, details: { tarefas: [UMA_TAREFA] } });

    expect(b!.mensagem).toContain("única responsável");
  });

  it("titulo vazio vira marcador visivel, e a tarefa NAO some", () => {
    const b = bloqueioDeAlcance(erro({ tarefas: [{ id: "x", titulo: "  " }] }));

    expect(b!.tarefas).toHaveLength(1);
    expect(b!.tarefas[0].titulo).toBe("(sem título)");
  });
});

describe("tituloDoBloqueio()", () => {
  it("tem texto proprio para as TRES acoes da E4", () => {
    expect(tituloDoBloqueio("move_member_subteam")).toContain("mover");
    expect(tituloDoBloqueio("remove_member_from_team")).toContain("remover");
    expect(tituloDoBloqueio("change_member_role")).toContain("papel");
  });

  it("cai num texto generico para acao desconhecida ou ausente", () => {
    expect(tituloDoBloqueio(null)).toBe("Não dá para concluir ainda");
    expect(tituloDoBloqueio("deactivate_member")).toBe("Não dá para concluir ainda");
  });
});
