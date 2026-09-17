// Regras da tela de gestao de times (Spec 029, Fatia 4).
import { describe, expect, it } from "vitest";
import {
  confirmacaoValida,
  descreveConteudo,
  ehRaiz,
  estaVazio,
  motivoNaoRemove,
  ordenaParaTela,
  podeApagarTime,
  podeEditar,
  podeEsvaziarERemover,
  resumoDoEsvaziamento,
  sugereSlug,
  type TimeGerenciavel,
} from "@/lib/gestaoTimes";

// ⚠️ Spec 051, fatia D: quem APAGA vem do servidor, por time (`can_delete`), e
// nao mais de `me.permissions`. Ate ali estes testes montavam listas de
// permissao (ADMIN com `subteam.delete`, MANAGER sem) -- e o gerente passou a
// apagar subtime da propria arvore, que uma lista "em algum lugar" nao sabe
// dizer.
const APAGA = { can_delete: true };
const NAO_APAGA = { can_delete: false };

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

describe("podeEditar -- o cadeado vem do servidor (Spec 049, fatia F)", () => {
  it("subtime que o servidor diz editavel: edita", () => {
    expect(podeEditar({ ...time(), can_update: true })).toBe(true);
  });

  it("⚠️ o servidor diz que nao (o subtime IRMAO do supervisor): nao edita", () => {
    // A pergunta que a tela nao sabe responder: a pessoa tem `subteam.update`,
    // mas nao NESTE time.
    expect(podeEditar({ ...time(), can_update: false })).toBe(false);
  });

  it("⚠️ AUSENTE e nao -- um Team de outra origem nao abre lapis", () => {
    expect(podeEditar(time())).toBe(false);
  });

  it("ninguem edita a raiz -- nem com o servidor dizendo sim (D5)", () => {
    expect(podeEditar({ ...time({ parent_team_id: null }), can_update: true })).toBe(
      false,
    );
  });
});

describe("podeApagarTime -- o cadeado vem do servidor (Spec 051, fatia D)", () => {
  it("subtime que o servidor diz apagavel: apaga", () => {
    expect(podeApagarTime(time(APAGA))).toBe(true);
  });

  it("⚠️ o servidor diz que nao (subtime de OUTRA arvore do gerente): nao apaga", () => {
    expect(podeApagarTime(time(NAO_APAGA))).toBe(false);
  });

  it("⚠️ AUSENTE e nao -- um Team de outra origem nao abre lixeira", () => {
    expect(podeApagarTime(time())).toBe(false);
  });

  it("ninguem apaga a raiz -- nem com o servidor dizendo sim (D5)", () => {
    expect(podeApagarTime(time({ ...APAGA, parent_team_id: null }))).toBe(false);
  });
});

describe("motivoNaoRemove", () => {
  it("devolve null quando da pra remover", () => {
    expect(motivoNaoRemove(time(APAGA))).toBe(null);
  });

  it("raiz vem antes de qualquer outro motivo", () => {
    const raizCheia = time({ ...APAGA, parent_team_id: null, tarefas: 214, membros: 5 });
    expect(motivoNaoRemove(raizCheia)).toContain("principal");
  });

  it("falta de permissao vem antes do conteudo", () => {
    // Mandar alguem esvaziar um time que ele nao poderia remover de qualquer
    // jeito e trabalho jogado fora.
    const motivo = motivoNaoRemove(time({ ...NAO_APAGA, tarefas: 14 }));
    expect(motivo).toContain("não remove");
    expect(motivo).not.toContain("14");
  });

  it("com permissao, explica o que falta esvaziar", () => {
    const motivo = motivoNaoRemove(time({ ...APAGA, tarefas: 14, membros: 2 }));
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
  it("aceita time COM conteudo", () => {
    const cheio = time({ ...APAGA, tarefas: 14, membros: 2 });
    expect(podeEsvaziarERemover(cheio)).toBe(true);
  });

  it("recusa time com subtime filho -- o filho tem de sair antes", () => {
    expect(podeEsvaziarERemover(time({ ...APAGA, filhos: 1 }))).toBe(false);
  });

  it("recusa a raiz e recusa quem o servidor diz que nao apaga", () => {
    expect(podeEsvaziarERemover(time({ ...APAGA, parent_team_id: null }))).toBe(false);
    expect(podeEsvaziarERemover(time({ ...NAO_APAGA, tarefas: 3 }))).toBe(false);
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
