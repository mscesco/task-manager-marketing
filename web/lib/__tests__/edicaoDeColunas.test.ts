/**
 * Spec 036, fatia 5b-6 -- as decisoes do modo de edicao de colunas.
 *
 * ⚠️ AS DUAS TRAVAS DA ADR 0042 RESPONDEM PERGUNTAS DIFERENTES, e confundi-las
 * e o defeito classico desta fatia:
 *   - "para onde vao estas tarefas?" (D5) -- o selector de destino;
 *   - "o quadro continua funcionando depois?" (D4) -- a recusa da ultima
 *     coluna `OPEN` ou `DONE`.
 * O selector NAO substitui a recusa: nada impede escolher `Backlog` como
 * destino ao apagar a ultima `DONE`, e a quebra so aparece na semana seguinte,
 * numa cascata de conclusao.
 *
 * ⚠️ E O AVISO DE DESTINO TERMINAL E O UNICO LUGAR ONDE A TELA PODE MENTIR SEM
 * ERRAR. "As 12 tarefas vão para Concluído" e verdade e e insuficiente: o que
 * acontece e que 12 trabalhos sao ENCERRADOS, com cascata de subtarefas,
 * relogio de arquivamento ligando e avisos de prazo morrendo.
 *
 * SABOTAGENS (medidas):
 *   AA. `impedimentoDeExclusao` sem conferir se sobra outra da semantica.
 *   AB. `SEMANTICAS_OBRIGATORIAS` com as quatro em vez de duas.
 *   AC. `destinoEhTerminal` so com `DONE`.
 *   AD. `explicaRecusa` comparando a mensagem em vez do codigo.
 *   AE. `mensagemDeDivergencia` so quando moveu MAIS.
 */

import { describe, expect, it } from "vitest";

import type { Coluna } from "@/lib/coluna";
import {
  CODIGO_SEMANTICA_OBRIGATORIA,
  CODIGO_SEM_DESTINO,
  avisoDeExclusao,
  destinoEhTerminal,
  destinosPara,
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
  };
}

/** As quatro colunas base de um quadro avulso recem-criado. */
const BACKLOG = col("c-back", "Backlog", 0, "OPEN");
const ANDAMENTO = col("c-and", "Em Andamento", 1, "IN_PROGRESS");
const CONCLUIDO = col("c-done", "Concluído", 2, "DONE");
const CANCELADO = col("c-canc", "Cancelado", 3, "CANCELLED");
const BASE = [BACKLOG, ANDAMENTO, CONCLUIDO, CANCELADO];

describe("impedimentoDeExclusao", () => {
  it("⚠️ a ultima OPEN nao pode ser apagada", () => {
    // Toda tarefa nasce em `BACKLOG`. Sem coluna `OPEN`, criar tarefa quebra.
    expect(impedimentoDeExclusao(BACKLOG, BASE)?.semantica).toBe("OPEN");
  });

  it("⚠️ a ultima DONE nao pode ser apagada", () => {
    // A cascata de conclusao procura `DONE`. Sem ela, concluir uma tarefa-mae
    // cuja subtarefa mora aqui estoura -- na semana seguinte, para outra
    // pessoa.
    expect(impedimentoDeExclusao(CONCLUIDO, BASE)?.semantica).toBe("DONE");
  });

  it("⚠️ IN_PROGRESS e CANCELLED PODEM ser apagadas", () => {
    // ⚠️ O CRITERIO E "QUEM ESCREVE STATUS SOZINHO", e nao "uma por
    // semantica". Nenhuma escrita automatica aponta para estas duas: uma
    // pessoa pedindo `IN_PROGRESS` num quadro sem ela leva 422 no ato, para
    // quem clicou. Quadro de duas colunas e valido.
    expect(impedimentoDeExclusao(ANDAMENTO, BASE)).toBeNull();
    expect(impedimentoDeExclusao(CANCELADO, BASE)).toBeNull();
  });

  it("⚠️ coluna NOVA da mesma semantica NAO libera apagar o ALVO", () => {
    // ⚠️ O BURACO QUE A ESCOLHA DE SEMANTICA NA CRIACAO ABRIU (12/08). Coluna
    // criada por gente nasce SEMPRE com `is_default_target: false`. Conferir
    // so a semantica deixaria a tela oferecer "Apagar" no `Backlog` assim que
    // alguem criasse uma segunda coluna de inicio -- e o quadro ficaria com
    // coluna de inicio e SEM ALVO de inicio, que e o que o degrau 2 da ADR
    // 0042 procura. Toda criacao de tarefa naquele quadro passaria a falhar.
    const ideias: Coluna = {
      ...col("c-ideias", "Ideias", 4, "OPEN"),
      is_default_target: false,
    };
    const comDuasOpen = [...BASE, ideias];
    expect(impedimentoDeExclusao(BACKLOG, comDuasOpen)?.semantica).toBe("OPEN");
    // ...e a coluna nova pode ir a vontade: ela nao e alvo de nada.
    expect(impedimentoDeExclusao(ideias, comDuasOpen)).toBeNull();
  });

  it("⚠️ com DUAS colunas DONE, uma delas pode ir", () => {
    // ⚠️ A TRAVA E SOBRE A ULTIMA, e nao sobre a semantica ser intocavel. Sem
    // este caso, uma regra escrita como "nao se apaga coluna DONE" ficaria
    // verde em todos os outros testes deste arquivo.
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

describe("destinosPara", () => {
  it("oferece TODAS as outras, ordenadas por posicao", () => {
    expect(destinosPara(ANDAMENTO, BASE).map((c) => c.id)).toEqual([
      "c-back",
      "c-done",
      "c-canc",
    ]);
  });

  it("⚠️ NAO filtra por semantica", () => {
    // Mandar um lote em andamento para `Cancelado` e escolha legitima, e
    // frequente quando a coluna apagada era um estagio que deixou de existir.
    // Filtrar seria a tela decidindo por quem apaga.
    expect(destinosPara(ANDAMENTO, BASE).map((c) => c.semantic)).toContain(
      "CANCELLED",
    );
  });

  it("⚠️ ela mesma nao entra na lista", () => {
    // Oferece-la daria 422 do backend para uma escolha feita de boa fe.
    expect(destinosPara(ANDAMENTO, BASE).map((c) => c.id)).not.toContain(
      "c-and",
    );
  });
});

describe("destinoEhTerminal", () => {
  it("DONE e CANCELLED sao terminais", () => {
    expect(destinoEhTerminal(CONCLUIDO)).toBe(true);
    // ⚠️ CANCELADO TAMBEM, e esquece-lo e o erro provavel: ele nao "conclui"
    // nada, mas encerra a tarefa igual -- `terminal_since` liga, os avisos de
    // prazo param e a subarvore vai junto.
    expect(destinoEhTerminal(CANCELADO)).toBe(true);
  });

  it("OPEN e IN_PROGRESS nao sao", () => {
    expect(destinoEhTerminal(BACKLOG)).toBe(false);
    expect(destinoEhTerminal(ANDAMENTO)).toBe(false);
  });
});

describe("avisoDeExclusao", () => {
  it("⚠️ coluna VAZIA nao pergunta nada", () => {
    // E o que o backend faz. Inventar uma confirmacao aqui seria a tela sendo
    // mais cerimoniosa que a operacao.
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

  it("⚠️ destino TERMINAL diz que as tarefas serao CONCLUIDAS", () => {
    // ⚠️ O TEXTO E O PONTO. "As 12 tarefas vão para Concluído" e verdade e e
    // insuficiente: quem le entende que esta arrumando o quadro, e o que
    // acontece e encerrar 12 trabalhos.
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

  it("⚠️ destino CANCELADO usa o verbo certo", () => {
    // Dizer "concluídas" ao cancelar seria mentira num aviso que existe para
    // impedir exatamente esse tipo de engano.
    const aviso = avisoDeExclusao({
      coluna: ANDAMENTO,
      destino: CANCELADO,
      quantas: 3,
    });
    expect(aviso?.terminal).toBe(true);
    expect(aviso?.titulo).toContain("canceladas");
    expect(aviso?.titulo).not.toContain("concluídas");
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

  it("⚠️ moveu MAIS do que o aviso dizia -> avisa", () => {
    // Alguem moveu uma tarefa para ca entre o aviso e a confirmacao. O lote
    // foi maior que o aprovado.
    expect(mensagemDeDivergencia(12, 14)).toContain("14");
  });

  it("⚠️ moveu MENOS tambem avisa", () => {
    // ⚠️ A TELA TEM DOIS NUMEROS E NAO O MOTIVO -- nao da para saber se entrou
    // ou saiu tarefa. Calar aqui parece inofensivo, e e a mesma linha que
    // calaria no outro caso. O custo de um aviso desnecessario e menor.
    expect(mensagemDeDivergencia(12, 9)).toContain("9");
  });
});

describe("explicaRecusa", () => {
  it("⚠️ le o CODIGO, e traduz cada um diferente", () => {
    // As duas recusas sao 422. Distingui-las pela mensagem acoplaria a tela ao
    // portugues do backend.
    const semDestino = explicaRecusa(CODIGO_SEM_DESTINO);
    const semantica = explicaRecusa(CODIGO_SEMANTICA_OBRIGATORIA);
    expect(semDestino).toBeTruthy();
    expect(semantica).toBeTruthy();
    expect(semDestino).not.toBe(semantica);
  });

  it("⚠️ codigo desconhecido devolve null -- a tela mostra o backend", () => {
    // Inventar texto proprio para erro que nao previmos esconderia a causa de
    // quem esta olhando a tela.
    expect(explicaRecusa("validation_error")).toBeNull();
    expect(explicaRecusa(undefined)).toBeNull();
  });
});
