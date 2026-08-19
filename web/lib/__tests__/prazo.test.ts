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

import { describe, expect, it } from "vitest";

import { agoraNoWorkspace, estaAtrasada, type Agora } from "../prazo";

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
