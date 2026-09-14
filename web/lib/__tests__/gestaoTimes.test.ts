// Regras da tela de gestao de times (Spec 029, Fatia 4).
import { describe, expect, it } from "vitest";
import {
  confirmacaoValida,
  descreveConteudo,
  ehRaiz,
  estaVazio,
  motivoNaoRemove,
  ordenaParaTela,
  podeEditar,
  podeEsvaziarERemover,
  podeRemover,
  resumoDoEsvaziamento,
  sugereSlug,
  type TimeGerenciavel,
} from "@/lib/gestaoTimes";
import type { Permission } from "@/lib/permissions.generated";

// Spec 049, fatia A: eram `workspace.manage` + `team.manage`, e `team.manage`.
const ADMIN: Permission[] = ["subteam.delete", "subteam.update", "subteam.create"];
const MANAGER: Permission[] = ["subteam.update", "subteam.create"];
const OPERATOR: Permission[] = [];

function time(over: Partial<TimeGerenciavel> = {}): TimeGerenciavel {
  return {
    id: "t1",
    name: "Copy",
    slug: "copy",
    parent_team_id: "raiz",
    tarefas: 0,
    projetos: 0,
    membros: 0,
    filhos: 0,
    ...over,
  };
}

describe("ehRaiz / estaVazio", () => {
  it("raiz e quem nao tem pai", () => {
    expect(ehRaiz({ parent_team_id: null })).toBe(true);
    expect(ehRaiz({ parent_team_id: "raiz" })).toBe(false);
  });

  it("vazio exige zero nas QUATRO contagens", () => {
    expect(estaVazio({ tarefas: 0, projetos: 0, membros: 0, filhos: 0 })).toBe(true);
    expect(estaVazio({ tarefas: 1, projetos: 0, membros: 0, filhos: 0 })).toBe(false);
    expect(estaVazio({ tarefas: 0, projetos: 1, membros: 0, filhos: 0 })).toBe(false);
    expect(estaVazio({ tarefas: 0, projetos: 0, membros: 1, filhos: 0 })).toBe(false);
    expect(estaVazio({ tarefas: 0, projetos: 0, membros: 0, filhos: 1 })).toBe(false);
  });
});

describe("podeEditar", () => {
  it("MANAGER edita subtime", () => {
    expect(podeEditar(time(), MANAGER)).toBe(true);
  });

  it("ninguem edita a raiz -- nem ADMIN (D5)", () => {
    expect(podeEditar(time({ parent_team_id: null }), ADMIN)).toBe(false);
  });

  it("sem team.manage nao edita", () => {
    expect(podeEditar(time(), OPERATOR)).toBe(false);
  });
});

describe("podeRemover", () => {
  it("ADMIN remove subtime vazio", () => {
    expect(podeRemover(time(), ADMIN)).toBe(true);
  });

  it("MANAGER NAO remove, mesmo com o time vazio (D1)", () => {
    // Este e o ponto que separa remover de criar/editar: MANAGER tem
    // team.manage, mas remover exige workspace.manage.
    expect(podeRemover(time(), MANAGER)).toBe(false);
  });

  it("ADMIN nao remove time com conteudo", () => {
    expect(podeRemover(time({ tarefas: 14 }), ADMIN)).toBe(false);
    expect(podeRemover(time({ membros: 2 }), ADMIN)).toBe(false);
    expect(podeRemover(time({ filhos: 1 }), ADMIN)).toBe(false);
  });

  it("ADMIN nao remove a raiz (D5)", () => {
    expect(podeRemover(time({ parent_team_id: null }), ADMIN)).toBe(false);
  });
});

describe("motivoNaoRemove", () => {
  it("devolve null quando da pra remover", () => {
    expect(motivoNaoRemove(time(), ADMIN)).toBe(null);
  });

  it("raiz vem antes de qualquer outro motivo", () => {
    const raizCheia = time({ parent_team_id: null, tarefas: 214, membros: 5 });
    expect(motivoNaoRemove(raizCheia, ADMIN)).toContain("principal");
  });

  it("falta de permissao vem antes do conteudo", () => {
    // Mandar um MANAGER esvaziar um time que ele nao poderia remover de
    // qualquer jeito e trabalho jogado fora.
    const motivo = motivoNaoRemove(time({ tarefas: 14 }), MANAGER);
    expect(motivo).toContain("administrador");
    expect(motivo).not.toContain("14");
  });

  it("com permissao, explica o que falta esvaziar", () => {
    const motivo = motivoNaoRemove(time({ tarefas: 14, membros: 2 }), ADMIN);
    expect(motivo).toContain("14 tarefas");
    expect(motivo).toContain("2 membros");
  });
});

describe("descreveConteudo", () => {
  it("omite os zeros", () => {
    expect(descreveConteudo({ tarefas: 3, projetos: 0, membros: 2, filhos: 0 })).toBe(
      "3 tarefas, 2 membros"
    );
  });

  it("singular e plural", () => {
    expect(descreveConteudo({ tarefas: 1, projetos: 0, membros: 0, filhos: 0 })).toBe(
      "1 tarefa"
    );
    expect(descreveConteudo({ tarefas: 0, projetos: 0, membros: 0, filhos: 1 })).toBe(
      "1 subtime"
    );
  });

  it("string vazia quando nao ha nada", () => {
    expect(descreveConteudo({ tarefas: 0, projetos: 0, membros: 0, filhos: 0 })).toBe("");
  });
});

describe("confirmacaoValida", () => {
  it("aceita o nome exato", () => {
    expect(confirmacaoValida("Copy", "Copy")).toBe(true);
  });

  it("tolera espaco nas pontas e caixa", () => {
    expect(confirmacaoValida("  copy ", "Copy")).toBe(true);
    expect(confirmacaoValida("CRM E AUTOMAÇÃO", "CRM e Automação")).toBe(true);
  });

  it("recusa vazio -- e o clique acidental que o D2 existe pra impedir", () => {
    expect(confirmacaoValida("", "Copy")).toBe(false);
    expect(confirmacaoValida("   ", "Copy")).toBe(false);
  });

  it("recusa nome parecido ou de outro time", () => {
    expect(confirmacaoValida("Cop", "Copy")).toBe(false);
    expect(confirmacaoValida("Copywriting", "Copy")).toBe(false);
    expect(confirmacaoValida("SEO", "Copy")).toBe(false);
  });

  it("recusa quando o time nao tem nome (estado impossivel, falha fechada)", () => {
    expect(confirmacaoValida("", "")).toBe(false);
  });
});

describe("sugereSlug", () => {
  it("tira acento, espaco e caixa", () => {
    expect(sugereSlug("CRM e Automação")).toBe("crm-e-automacao");
    expect(sugereSlug("Mídias Sociais")).toBe("midias-sociais");
  });

  it("nao deixa hifen sobrando nas pontas", () => {
    expect(sugereSlug("  Tráfego Pago  ")).toBe("trafego-pago");
    expect(sugereSlug("!!Design!!")).toBe("design");
  });

  it("respeita o formato que o backend aceita", () => {
    expect(sugereSlug("Time 2026 / Beta")).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("ordenaParaTela", () => {
  it("raiz primeiro, subtimes por nome pt-BR", () => {
    const lista = [
      { name: "SEO", parent_team_id: "r" },
      { name: "Áudio", parent_team_id: "r" },
      { name: "Marketing", parent_team_id: null },
      { name: "Copy", parent_team_id: "r" },
    ];
    expect(ordenaParaTela(lista).map((t) => t.name)).toEqual([
      "Marketing",
      "Áudio",
      "Copy",
      "SEO",
    ]);
  });
});

// -------------------------------------------------------------------
// Fatia 3 -- esvaziar e remover (D3-B)
// -------------------------------------------------------------------
describe("podeEsvaziarERemover", () => {
  it("aceita time COM conteudo -- e o que diferencia de podeRemover", () => {
    const cheio = time({ tarefas: 14, membros: 2 });
    expect(podeRemover(cheio, ADMIN)).toBe(false);
    expect(podeEsvaziarERemover(cheio, ADMIN)).toBe(true);
  });

  it("recusa time com subtime filho -- o filho tem de sair antes", () => {
    expect(podeEsvaziarERemover(time({ filhos: 1 }), ADMIN)).toBe(false);
  });

  it("recusa a raiz e recusa quem nao e admin", () => {
    expect(podeEsvaziarERemover(time({ parent_team_id: null }), ADMIN)).toBe(false);
    expect(podeEsvaziarERemover(time({ tarefas: 3 }), MANAGER)).toBe(false);
  });
});

describe("resumoDoEsvaziamento", () => {
  const base = { tarefas_vivas: 0, tarefas_na_lixeira: 0, projetos: 0, membros: 0 };

  it("separa vivas de lixeira -- juntar seria mentira", () => {
    // "10 tarefas serao arquivadas" e falso quando 7 estao na lixeira e so
    // trocam de time. Este e o caso real do CRM e Automacao (3 vivas, 7 na
    // lixeira), medido em 29/07.
    const linhas = resumoDoEsvaziamento({
      ...base,
      tarefas_vivas: 3,
      tarefas_na_lixeira: 7,
    });
    expect(linhas[0]).toContain("3 tarefas serão arquivadas");
    expect(linhas[1]).toContain("7 tarefas excluídas");
  });

  it("omite o que e zero", () => {
    const linhas = resumoDoEsvaziamento({ ...base, membros: 2 });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("2 membros");
  });

  it("singular e plural", () => {
    expect(resumoDoEsvaziamento({ ...base, tarefas_vivas: 1 })[0]).toContain(
      "1 tarefa será arquivada"
    );
    expect(resumoDoEsvaziamento({ ...base, membros: 1 })[0]).toContain("1 membro irá");
  });

  it("lista vazia quando o time esta limpo", () => {
    expect(resumoDoEsvaziamento(base)).toEqual([]);
  });
});
