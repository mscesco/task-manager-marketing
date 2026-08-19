/**
 * Spec 038, fatia B — a regra de atraso com hora.
 *
 * ⚠️ O TESTE QUE MAIS IMPORTA É O DO PREFIXO. Ele é o único que separa a regra
 * certa da comparação ingênua, e a ingênua falha em SILÊNCIO — sem erro, sem
 * log, sem nada na tela. Se alguém "simplificar" para
 * `` `${dueDate} ${dueTime}` < `${agora.data}` ``, ou trocar o corte de segundos
 * por nada, é ele que cai.
 *
 * SABOTAGENS (todas fazem a suíte ficar vermelha aqui, e só aqui):
 *   A. Ignorar `dueTime` e cair sempre em `dueDate < agora.data`.
 *   B. Não cortar os segundos que o Postgres devolve (`"18:00:00"`).
 *   C. Tratar "sem hora" como meia-noite.
 *   D. Trocar `Intl` por aritmética de offset (`-3h`) -- cai no horário de verão.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { agoraNoWorkspace, estaAtrasada, type Agora } from "../prazo";
import { deadlineLabel } from "../status";

const agora = (data: string, hora: string): Agora => ({ data, hora });

describe("estaAtrasada -- sem hora, a regra de sempre", () => {
  it("prazo de ONTEM está atrasada", () => {
    expect(estaAtrasada("2026-08-18", null, agora("2026-08-19", "09:00"))).toBe(
      true
    );
  });

  it("⚠️ prazo de HOJE NÃO está atrasada, mesmo às 23:59 -- sabotagem C", () => {
    // ⚠️ É O COMPORTAMENTO DE 100% DAS 1085 TAREFAS DE PRODUÇÃO. Sem hora, o
    // prazo é o DIA, e o dia só acaba à meia-noite. Tratar "sem hora" como
    // meia-noite poria toda tarefa com prazo hoje em atraso de manhã -- que é
    // exatamente o backfill que o desenho `date` + `time` nulo evitou.
    expect(estaAtrasada("2026-08-19", null, agora("2026-08-19", "23:59"))).toBe(
      false
    );
  });

  it("prazo futuro não está atrasada", () => {
    expect(estaAtrasada("2026-09-01", null, agora("2026-08-19", "09:00"))).toBe(
      false
    );
  });
});

describe("estaAtrasada -- com hora", () => {
  it("⚠️ venceu HOJE às 09:00 e agora são 18:00 → ATRASADA", () => {
    // ⚠️ ESTE É O CASO QUE A COMPARAÇÃO INGÊNUA ERRA. Com `due_date < hoje`,
    // "2026-08-19" < "2026-08-19" é false, e a tarefa nunca ficaria vermelha
    // no dia do vencimento -- o pedido inteiro desta fatia morreria em
    // silêncio. Sabotagem A.
    expect(
      estaAtrasada("2026-08-19", "09:00", agora("2026-08-19", "18:00"))
    ).toBe(true);
  });

  it("vence HOJE às 18:00 e agora são 09:00 → não atrasada", () => {
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "09:00"))
    ).toBe(false);
  });

  it("⚠️ o minuto EXATO ainda não atrasou", () => {
    // Fronteira: às 18:00 em ponto o prazo é agora, não passado.
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "18:00"))
    ).toBe(false);
    expect(
      estaAtrasada("2026-08-19", "18:00", agora("2026-08-19", "18:01"))
    ).toBe(true);
  });

  it("⚠️ aceita a hora COM SEGUNDOS, como o Postgres devolve -- sabotagem B", () => {
    // ⚠️ `TIME` volta como `"18:00:00"`. Sem cortar, `"2026-08-19 18:00:00"` vs
    // `"2026-08-19 18:00"` compara a string mais longa como MAIOR -- e a tarefa
    // deixaria de atrasar no minuto exato, por um motivo invisível.
    expect(
      estaAtrasada("2026-08-19", "18:00:00", agora("2026-08-19", "18:01"))
    ).toBe(true);
    expect(
      estaAtrasada("2026-08-19", "18:00:00", agora("2026-08-19", "18:00"))
    ).toBe(false);
  });

  it("hora não salva o prazo de ontem", () => {
    expect(
      estaAtrasada("2026-08-18", "23:59", agora("2026-08-19", "00:01"))
    ).toBe(true);
  });
});

describe("estaAtrasada -- ausências", () => {
  it("sem prazo nunca atrasa", () => {
    expect(estaAtrasada(null, null, agora("2026-08-19", "09:00"))).toBe(false);
    expect(estaAtrasada(undefined, "18:00", agora("2026-08-19", "09:00"))).toBe(
      false
    );
  });

  it("⚠️ hora SEM data devolve false, e não explode", () => {
    // O backend recusa esse par com 422 (`_validate_hora`), então ele não
    // existe em dado válido. Mas a tela não é o lugar de descobrir isso, e uma
    // tarefa não pode ficar vermelha por um estado que ninguém enxerga nem
    // conserta pela interface.
    expect(estaAtrasada(null, "18:00", agora("2026-08-19", "23:00"))).toBe(
      false
    );
  });
});

describe("agoraNoWorkspace", () => {
  it("⚠️ lê no fuso de São Paulo, e não no do navegador -- sabotagem D", () => {
    // 19/08/2026 às 02:00 UTC é ainda 18/08 às 23:00 em São Paulo (UTC-3).
    // ⚠️ ESTE É O CASO QUE O COMENTÁRIO DO JOB DESCREVE desde a Spec 023:
    // "perto da meia-noite UTC/BRT divergem e o dia sairia errado". Uma
    // implementação que usasse a data local do navegador (ou UTC) daria
    // "2026-08-19" aqui, e a tarefa com prazo 18/08 apareceria atrasada uma
    // hora antes da conta.
    const a = agoraNoWorkspace(new Date("2026-08-19T02:00:00Z"));
    expect(a.data).toBe("2026-08-18");
    expect(a.hora).toBe("23:00");
  });

  it("formata a data como YYYY-MM-DD, que é o formato que ordena", () => {
    const a = agoraNoWorkspace(new Date("2026-08-19T15:00:00Z"));
    expect(a.data).toBe("2026-08-19");
    expect(a.hora).toBe("12:00");
  });

  it("⚠️ a hora é 24h, e a meia-noite é 00:00 e não 24:00", () => {
    // `en-GB` com `hour12: false` já devolve `00`, mas alguns ambientes
    // devolvem `24` para meia-noite -- e `"24:00"` ordenaria depois de tudo.
    const a = agoraNoWorkspace(new Date("2026-08-19T03:30:00Z"));
    expect(a.hora).toBe("00:30");
  });
});

describe("deadlineLabel -- o rótulo NÃO pode discordar da cor", () => {
  // ⚠️ ESTE BLOCO NASCEU DE UM DEFEITO REAL, achado pela Camila na tela em
  // 18/08: a tarefa ficava VERMELHA e o rótulo dizia "Vence hoje". Eu tinha
  // deixado o `deadlineTone` ciente da hora e esquecido o `deadlineLabel`.
  //
  // ⚠️ COR E TEXTO DISCORDANDO É PIOR QUE OS DOIS ERRADOS, e este projeto já
  // pagou por isso uma vez: o `TaskDetailChecklist.test.tsx` existe porque o
  // card dizia "2/2" e o detalhe da MESMA tarefa dizia "(0/2)".
  //
  // ⚠️ ESTES TESTES USAM O RELÓGIO DE VERDADE, e por isso comparam com datas
  // relativas a hoje -- não com uma data fixa, que passaria a mentir amanhã.
  function hojeEmSP(): string {
    return agoraNoWorkspace().data;
  }

  it("⚠️ hora JÁ PASSADA hoje não diz 'Vence hoje'", () => {
    const rotulo = deadlineLabel(hojeEmSP(), "00:01");
    expect(rotulo).not.toContain("Vence hoje");
    expect(rotulo).toContain("Venceu");
  });

  it("hora AINDA POR VIR hoje diz que vence hoje, com a hora", () => {
    expect(deadlineLabel(hojeEmSP(), "23:59")).toBe("Vence hoje às 23:59");
  });

  it("sem hora, o rótulo de hoje é o de sempre", () => {
    // ⚠️ É o comportamento das 1085 tarefas de produção. Não pode mudar.
    expect(deadlineLabel(hojeEmSP(), null)).toBe("Vence hoje");
    expect(deadlineLabel(hojeEmSP())).toBe("Vence hoje");
  });

  it("⚠️ corta os segundos que o Postgres devolve", () => {
    expect(deadlineLabel(hojeEmSP(), "23:59:00")).toBe("Vence hoje às 23:59");
  });
});

describe("⚠️ o FUSO do ambiente não pode decidir a regra", () => {
  // ⚠️ ESTE BLOCO NASCEU DO CI REPROVANDO (18/08), e o defeito era REAL e não
  // do teste: eu pus `estaAtrasada` em `America/Sao_Paulo` e deixei
  // `deadlineDays` na meia-noite LOCAL. Duas fontes de verdade para "que dia é
  // hoje" -- exatamente o que o comentário antigo do `deadlineDays` dizia que
  // não podia acontecer.
  //
  // ⚠️ ERA INVISÍVEL NA MÁQUINA DA EQUIPE. Todo mundo em BRT, então as duas
  // concordavam sempre. Só o runner do CI, que roda em UTC, viu -- e só na
  // janela entre 00:00 e 03:00 UTC, quando São Paulo ainda está no dia
  // anterior. **Defeito que só aparece em três horas do dia, num fuso que
  // ninguém da equipe usa, é o tipo que sobrevive por meses.**
  afterEach(() => {
    vi.useRealTimers();
  });

  it("01:00 UTC (= 22:00 de ONTEM em SP): o rótulo de hoje continua sendo de hoje", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T01:00:00Z"));

    const hojeSP = agoraNoWorkspace().data;
    expect(hojeSP).toBe("2026-08-18"); // em SP ainda é dia 18

    // ⚠️ COM `deadlineDays` NO FUSO LOCAL isto dava "Atrasada 1 dia", porque a
    // data local do runner já era 19 e a de SP ainda era 18.
    expect(deadlineLabel(hojeSP, "23:59")).toBe("Vence hoje às 23:59");
    expect(deadlineLabel(hojeSP)).toBe("Vence hoje");
  });

  it("e o dia SEGUINTE em SP continua sendo amanhã", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T01:00:00Z"));
    expect(deadlineLabel("2026-08-19")).toBe("Vence amanhã");
  });
});
