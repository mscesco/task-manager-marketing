/**
 * As decisoes do modo de edicao de colunas. Duas travas respondem perguntas
 * diferentes: "para onde vao estas tarefas?" (o selector de destino) e "o
 * quadro continua funcionando depois?" (a recusa da ultima `OPEN` ou `DONE`).
 * O selector nao substitui a recusa: escolher `Backlog` como destino ao apagar
 * a ultima `DONE` quebra a cascata de conclusao mais tarde.
 */

import { describe, expect, it } from "vitest";

import type { Coluna } from "@/lib/coluna";
import {
  CODIGO_SEM_DESTINO,
  CODIGO_SEMANTICA_OBRIGATORIA,
  avisoDeExclusao,
  destinoEhTerminal,
  explicaRecusa,
  impedimentoDeExclusao,
  mensagemDeDivergencia,
} from "@/lib/edicaoDeColunas";

function col(
  id: string,
  name: string,
  position: number,
  semantic: Coluna["semantic"],
): Coluna {
  return {
    id,
    name,
    color: "var(--status-backlog-dot)",
    position,
    semantic,
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  };
}

/** As quatro colunas base de um quadro avulso recem-criado. */
const BACKLOG = col("c-back", "Backlog", 0, "OPEN");
const ANDAMENTO = col("c-and", "Em Andamento", 1, "IN_PROGRESS");
const CONCLUIDO = col("c-done", "Concluído", 2, "DONE");
const CANCELADO = col("c-canc", "Cancelado", 3, "CANCELLED");
const BASE = [BACKLOG, ANDAMENTO, CONCLUIDO, CANCELADO];

describe("impedimentoDeExclusao", () => {
  it("a ultima OPEN nao pode ser apagada", () => {
    // Toda tarefa nasce em `BACKLOG`. Sem coluna `OPEN`, criar tarefa quebra.
    expect(impedimentoDeExclusao(BACKLOG, BASE)?.semantica).toBe("OPEN");
  });

  it("a ultima DONE nao pode ser apagada", () => {
    // A cascata de conclusao procura `DONE`.
    expect(impedimentoDeExclusao(CONCLUIDO, BASE)?.semantica).toBe("DONE");
  });

  it("IN_PROGRESS e CANCELLED PODEM ser apagadas", () => {
    // O criterio e "quem escreve status sozinho", nao "uma por semantica":
    // nenhuma escrita automatica aponta para estas duas.
    expect(impedimentoDeExclusao(ANDAMENTO, BASE)).toBeNull();
    expect(impedimentoDeExclusao(CANCELADO, BASE)).toBeNull();
  });

  it("coluna NOVA da mesma semantica NAO libera apagar o ALVO", () => {
    // Coluna criada por gente nasce com `is_default_target: false`. Conferir so
    // a semantica deixaria o quadro sem alvo de inicio, e criar tarefa falharia.
    const ideias: Coluna = {
      ...col("c-ideias", "Ideias", 4, "OPEN"),
      is_default_target: false,
      is_status_bridge: false,
    };
    const comDuasOpen = [...BASE, ideias];
    expect(impedimentoDeExclusao(BACKLOG, comDuasOpen)?.semantica).toBe("OPEN");
    // ...e a coluna nova pode ir a vontade: ela nao e alvo de nada.
    expect(impedimentoDeExclusao(ideias, comDuasOpen)).toBeNull();
  });

  it("com DUAS colunas DONE, uma delas pode ir", () => {
    // A trava e sobre a ultima, e nao sobre a semantica ser intocavel.
    const entregue = col("c-entregue", "Entregue", 4, "DONE");
    const comDuas = [...BASE, entregue];
    expect(impedimentoDeExclusao(CONCLUIDO, comDuas)).toBeNull();
    expect(impedimentoDeExclusao(entregue, comDuas)).toBeNull();
  });

  it("o motivo é texto pronto, e diz o que fazer antes", () => {
    const imp = impedimentoDeExclusao(CONCLUIDO, BASE);
    expect(imp?.motivo).toContain("conclusão");
    expect(imp?.motivo).toContain("Crie outra");
  });
});

describe("destinoEhTerminal", () => {
  it("DONE e CANCELLED sao terminais", () => {
    expect(destinoEhTerminal(CONCLUIDO)).toBe(true);
    // Cancelado tambem encerra a tarefa: `terminal_since` liga e os avisos de prazo param.
    expect(destinoEhTerminal(CANCELADO)).toBe(true);
  });

  it("OPEN e IN_PROGRESS nao sao", () => {
    expect(destinoEhTerminal(BACKLOG)).toBe(false);
    expect(destinoEhTerminal(ANDAMENTO)).toBe(false);
  });
});

describe("impedimentoDeExclusao -- a trava da PONTE (quadro padrao)", () => {
  // A trava le as duas metades: so `is_status_bridge` barraria as colunas base
  // de todo quadro avulso; so `quadroPadrao` barraria a coluna criada por
  // gente no Quadro geral. Os casos abaixo sao a tabela verdade.
  const PONTE = { ...col("c-plan", "Planejado", 1, "IN_PROGRESS"), is_status_bridge: true };
  const CRIADA = { ...col("c-nova", "Ideias", 9, "IN_PROGRESS"), is_status_bridge: false, is_default_target: false };
  const TODAS = [...BASE, PONTE, CRIADA];

  it("quadro PADRAO + coluna com ponte -> RECUSA", () => {
    // Espelha `BoardService._assert_ponte_sobrevive`.
    const imp = impedimentoDeExclusao(PONTE, TODAS, true);
    expect(imp).not.toBeNull();
    expect(imp!.motivo).toContain("origem de um status do sistema");
  });

  it("quadro AVULSO + coluna com ponte -> LIBERA", () => {
    // As colunas base de um quadro avulso tambem tem ponte (`board_defaults.py`),
    // e apaga-las tem de continuar funcionando.
    expect(impedimentoDeExclusao(PONTE, TODAS, false)).toBeNull();
    // E o default do parametro e `false`, para que esquecer de passa-lo nunca
    // vire "sumiu o botao de apagar".
    expect(impedimentoDeExclusao(PONTE, TODAS)).toBeNull();
  });

  it("quadro PADRAO + coluna criada por gente -> LIBERA", () => {
    // Coluna nova nasce sem ponte e nao segura funcao nenhuma.
    expect(impedimentoDeExclusao(CRIADA, TODAS, true)).toBeNull();
  });

  it("a ponte vence os outros impedimentos, e nao o contrario", () => {
    // `Backlog` tambem seria recusado pela semantica, mas "crie outra" nao
    // resolve aqui: a mensagem tem de ser a da ponte.
    const backlogPonte = { ...BACKLOG, is_status_bridge: true };
    const imp = impedimentoDeExclusao(backlogPonte, [...TODAS], true);
    expect(imp!.motivo).toContain("origem de um status do sistema");
    expect(imp!.motivo).not.toContain("Crie outra");
  });
});

describe("avisoDeExclusao", () => {
  it("coluna VAZIA nao pergunta nada", () => {
    expect(
      avisoDeExclusao({ coluna: ANDAMENTO, destino: null, quantas: 0 }),
    ).toBeNull();
  });

  it("com tarefas e SEM destino, pede o destino", () => {
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: null,
      quantas: 12,
    });
    expect(aviso?.titulo).toContain("12");
    expect(aviso?.terminal).toBe(false);
  });

  it("destino comum: diz quantas vao e para onde", () => {
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: BACKLOG,
      quantas: 12,
    });
    expect(aviso?.titulo).toContain("12");
    expect(aviso?.titulo).toContain("Backlog");
    expect(aviso?.terminal).toBe(false);
  });

  it("destino TERMINAL diz que as tarefas serao CONCLUIDAS", () => {
    // "Vão para Concluído" seria insuficiente: o que acontece e encerrar os trabalhos.
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: CONCLUIDO,
      quantas: 12,
    });
    expect(aviso?.terminal).toBe(true);
    expect(aviso?.titulo).toContain("concluídas");
    const tudo = aviso!.linhas.join(" ");
    // As tres consequencias que nao sao obvias por si.
    expect(tudo).toContain("subtarefas");
    expect(tudo).toContain("prazo");
    expect(tudo).toContain("arquivamento");
  });

  it("destino CANCELADO usa o verbo certo", () => {
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: CANCELADO,
      quantas: 3,
    });
    expect(aviso?.terminal).toBe(true);
    expect(aviso?.titulo).toContain("canceladas");
    expect(aviso?.titulo).not.toContain("concluídas");
  });

  it("com exigeDestino, coluna vazia PERGUNTA -- e nao AFIRMA que ha apagadas", () => {
    // `exigeDestino` diz "pergunte de qualquer forma", nao que existe apagada:
    // a contagem do front conta so as vivas.
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: null,
      quantas: 0,
      exigeDestino: true,
    });
    expect(aviso).not.toBeNull();
    const tudo = `${aviso!.titulo} ${aviso!.linhas.join(" ")}`;
    expect(tudo).toContain("pode guardar");
    expect(tudo).toContain("Se não houver nenhuma, nada acontece");
    expect(tudo).not.toContain("ainda guarda tarefas apagadas");
    // Nunca terminal com zero: as apagadas nao sao concluidas.
    expect(aviso!.terminal).toBe(false);
  });

  it("o destino terminal NAO muda o texto da coluna vazia", () => {
    // As apagadas vao por UPDATE direto, sem cascata: nao ha conclusao em massa.
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: CONCLUIDO,
      quantas: 0,
      exigeDestino: true,
    });
    expect(aviso!.terminal).toBe(false);
    expect(aviso!.titulo).not.toContain("concluídas");
  });

  it("uma tarefa so nao fica no plural", () => {
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: BACKLOG,
      quantas: 1,
    });
    expect(aviso?.titulo).toContain("1 tarefa vai");
  });
});

describe("mensagemDeDivergencia", () => {
  it("numeros iguais nao geram aviso", () => {
    expect(mensagemDeDivergencia(12, 12)).toBeNull();
  });

  it("moveu MAIS do que o aviso dizia -> avisa", () => {
    expect(mensagemDeDivergencia(12, 14)).toContain("14");
  });

  it("moveu MENOS tambem avisa", () => {
    // A tela tem os dois numeros, nao o motivo: nao da para saber se entrou ou saiu.
    expect(mensagemDeDivergencia(12, 9)).toContain("9");
  });
});

describe("explicaRecusa", () => {
  it("nome repetido: o texto diz 'alguem mexeu', e nao 'escolha outro nome'", () => {
    // A tela ja barra o nome repetido antes de mandar; chegar neste codigo
    // significa que outra pessoa renomeou uma coluna durante a edicao.
    const texto = explicaRecusa("coluna_nome_repetido");
    expect(texto).not.toBeNull();
    expect(texto).toContain("enquanto você editava");
    expect(texto).not.toContain("Escolha outro nome");
  });

  it("le o CODIGO, e traduz cada um diferente", () => {
    // As duas recusas sao 422. Distingui-las pela mensagem acoplaria a tela ao
    // portugues do backend.
    const semDestino = explicaRecusa(CODIGO_SEM_DESTINO);
    const semantica = explicaRecusa(CODIGO_SEMANTICA_OBRIGATORIA);
    expect(semDestino).toBeTruthy();
    expect(semantica).toBeTruthy();
    expect(semDestino).not.toBe(semantica);
  });

  it("codigo desconhecido devolve null -- a tela mostra o backend", () => {
    // Inventar texto proprio para erro que nao previmos esconderia a causa de
    // quem esta olhando a tela.
    expect(explicaRecusa("validation_error")).toBeNull();
    expect(explicaRecusa(undefined)).toBeNull();
  });
});
