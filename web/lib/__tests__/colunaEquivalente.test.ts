/**
 * Spec 036, fatia 5b-5 -- a ADR 0042 do backend, escrita no front.
 *
 * ⚠️ DUAS IMPLEMENTACOES DA MESMA REGRA. O backend responde `status -> coluna`
 * em `BoardRepository.coluna_para_status` (e outra vez, em SQL, dentro de
 * `complete_descendants`). Aqui a pergunta e `coluna de outro quadro -> coluna
 * desta tela`, com os MESMOS dois degraus: exata primeiro, alvo da semantica
 * depois. Este arquivo e o unico lugar onde essa duplicacao fica honesta --
 * mesmo remedio de `paridadeColuna.test.ts`.
 *
 * ⚠️ A FIXTURE SEPARA POSICAO DE ALVO, e isso e a condicao de o arquivo valer
 * alguma coisa. `Backlog` e a primeira POR POSICAO e `Em Andamento` e o alvo
 * de `IN_PROGRESS`: a regra certa e a errada ("a primeira que achar") dao
 * respostas DIFERENTES. Fixture que nao discrimina foi o que deixou tres
 * sabotagens passarem verde na 4c.
 */

import { describe, expect, it } from "vitest";
import {
  colunaEquivalente,
  indiceDeColunas,
  rotuloDeColuna,
  type Coluna,
} from "@/lib/coluna";

function col(
  id: string,
  name: string,
  semantic: Coluna["semantic"],
  position: number,
  is_default_target: boolean,
): Coluna {
  // ⚠️ Declara `: Coluna` e monta o literal, em vez de `as Coluna`. O `as`
  // cala o `tsc` sobre campo inexistente -- armadilha catalogada.
  return {
    id,
    name,
    color: "var(--x)",
    position,
    semantic,
    notify_deadline: true,
    is_default_target,
  };
}

/** O Quadro geral, como producao o tem em 11/08: 8 colunas, 4 alvos. */
const GERAL: Coluna[] = [
  col("g1", "Backlog", "OPEN", 0, true),
  col("g2", "Planejado", "OPEN", 1, false),
  col("g3", "Em Andamento", "IN_PROGRESS", 2, true),
  col("g4", "Aprovação Interna", "IN_PROGRESS", 3, false),
  col("g5", "Aprovação Externa", "IN_PROGRESS", 4, false),
  col("g6", "Concluído", "DONE", 5, true),
  col("g7", "Cancelado", "CANCELLED", 6, true),
  col("g8", "Bloqueado", "IN_PROGRESS", 7, false),
];

/** Um quadro avulso de 4 colunas, mais uma criada por gente. */
const AVULSO: Coluna[] = [
  col("a1", "Backlog", "OPEN", 0, true),
  col("a2", "Em Andamento", "IN_PROGRESS", 1, true),
  col("a3", "Em Revisão", "IN_PROGRESS", 2, false),
  col("a4", "Concluído", "DONE", 3, true),
  col("a5", "Cancelado", "CANCELLED", 4, true),
];

describe("colunaEquivalente", () => {
  it("degrau 1: a coluna do proprio quadro e ela mesma", () => {
    for (const c of GERAL) {
      expect(colunaEquivalente(c, GERAL)?.id).toBe(c.id);
    }
  });

  it("⚠️ o degrau exato vem ANTES do alvo da semantica", () => {
    // `Aprovação Externa` tem semantica IN_PROGRESS, e `Em Andamento` e o alvo
    // dessa semantica. Invertendo os degraus, esta linha devolveria `g3`.
    expect(colunaEquivalente(GERAL[4], GERAL)?.name).toBe("Aprovação Externa");
  });

  it("degrau 2: coluna de outro quadro cai no alvo da semantica", () => {
    // "Em Revisão" (avulso, IN_PROGRESS, NAO e alvo) -> "Em Andamento" no
    // geral. ⚠️ E NAO "Backlog", que e a primeira por posicao.
    expect(colunaEquivalente(AVULSO[2], GERAL)?.name).toBe("Em Andamento");
  });

  it("⚠️ a resposta NAO depende da ordem do array", () => {
    // ⚠️ ESTE TESTE EXISTE PORQUE A FIXTURE ACIMA NAO DISCRIMINA, e isso foi
    // MEDIDO em 11/08: no `GERAL`, `Em Andamento` e a primeira `IN_PROGRESS`
    // por posicao E e o alvo -- entao "o alvo da semantica" e "a primeira da
    // semantica" respondem igual, e a sabotagem que tira o
    // `is_default_target` derrubava so o caso de borda.
    //
    // Aqui a ordem do array poe `Aprovação Interna` (IN_PROGRESS, NAO e alvo)
    // ANTES de `Em Andamento`. A resposta certa continua sendo `Em Andamento`;
    // a regra errada devolve `Aprovação Interna`.
    const embaralhado = [
      GERAL[3], // Aprovação Interna
      GERAL[4], // Aprovação Externa
      GERAL[7], // Bloqueado
      GERAL[2], // Em Andamento  <- o alvo, por ultimo
      GERAL[1], // Planejado
      GERAL[0], // Backlog       <- o alvo de OPEN, depois do Planejado
      GERAL[5],
      GERAL[6],
    ];
    expect(colunaEquivalente(AVULSO[2], embaralhado)?.name).toBe(
      "Em Andamento",
    );
    // E o mesmo vale para `OPEN`: `Planejado` vem antes de `Backlog`.
    const plannedAvulso = col("z1", "A fazer", "OPEN", 0, false);
    expect(colunaEquivalente(plannedAvulso, embaralhado)?.name).toBe("Backlog");
  });

  it("degrau 2 nas quatro semanticas, do avulso para o geral", () => {
    const esperado: Array<[string, string]> = [
      ["Backlog", "Backlog"],
      ["Em Andamento", "Em Andamento"],
      ["Em Revisão", "Em Andamento"],
      ["Concluído", "Concluído"],
      ["Cancelado", "Cancelado"],
    ];
    for (const [origem, destino] of esperado) {
      const c = AVULSO.find((x) => x.name === origem)!;
      expect(colunaEquivalente(c, GERAL)?.name).toBe(destino);
    }
  });

  it("do GERAL para o avulso, os quatro status extras colapsam", () => {
    // ⚠️ A PERDA E DE PROPOSITO e e a mesma da ADR 0042 D2: um quadro de quatro
    // colunas nao representa `Aprovação Externa` nem `Bloqueado`.
    expect(colunaEquivalente(GERAL[3], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[4], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[7], AVULSO)?.name).toBe("Em Andamento");
    expect(colunaEquivalente(GERAL[1], AVULSO)?.name).toBe("Backlog");
  });

  it("degrau 3: sem coluna daquela semantica devolve undefined", () => {
    // ⚠️ E `undefined`, NAO "a primeira coluna". Quem chama tem de avisar --
    // card que some da tela some com aviso, nunca em silencio.
    const semCancelado = GERAL.filter((c) => c.semantic !== "CANCELLED");
    expect(colunaEquivalente(AVULSO[4], semCancelado)).toBeUndefined();
  });

  it("semantica com coluna mas sem ALVO tambem devolve undefined", () => {
    // Estado que o CRUD da 5b-4 nao deve permitir, e que a funcao nao adivinha.
    const semAlvo = GERAL.map((c) =>
      c.semantic === "IN_PROGRESS" ? { ...c, is_default_target: false } : c,
    );
    expect(colunaEquivalente(AVULSO[2], semAlvo)).toBeUndefined();
  });

  it("destino vazio devolve undefined, e nao explode", () => {
    expect(colunaEquivalente(GERAL[0], [])).toBeUndefined();
  });
});

describe("indiceDeColunas", () => {
  const QUADROS = [
    { id: "b-geral", name: "Quadro geral", colunas: GERAL },
    { id: "b-campanhas", name: "Campanhas", colunas: AVULSO },
  ];

  it("coluna do quadro da tela vem com nomeDoQuadro null", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("g3")).toEqual({ coluna: GERAL[2], nomeDoQuadro: null });
  });

  it("coluna de outro quadro vem com o nome do quadro", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("a3")).toEqual({ coluna: AVULSO[2], nomeDoQuadro: "Campanhas" });
  });

  it("⚠️ o nome da coluna vem do quadro DONO dela, nao do quadro da tela", () => {
    // `Em Andamento` existe nos DOIS quadros, com ids diferentes. Uma
    // implementacao que resolvesse o nome pelo quadro da tela (ou pelo nome da
    // coluna, em vez do id) devolveria a mesma origem para `g3` e `a2` -- e a
    // tag mentiria sobre onde a tarefa mora, sem erro nenhum.
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("g3")?.nomeDoQuadro).toBeNull();
    expect(i.get("a2")?.nomeDoQuadro).toBe("Campanhas");
    expect(i.get("a2")?.coluna.name).toBe("Em Andamento");
    expect(i.get("a2")?.coluna.id).toBe("a2");
  });

  it("⚠️ guarda a COLUNA inteira, e nao so o nome dela", () => {
    // ⚠️ ESTE TESTE E O MOTIVO DE `OrigemDaColuna` TER MUDADO DE FORMA. As
    // telas transversais precisam de `semantic` e `is_default_target` para
    // AGRUPAR o card (`colunaEquivalente`) e de `notify_deadline` para decidir
    // o alerta de prazo (`deadlineTonePorColuna`). Um indice de nomes obriga a
    // tela a montar um segundo indice em paralelo -- e a ter um sem o outro.
    const i = indiceDeColunas(QUADROS, "b-geral");
    const origem = i.get("a3");
    expect(origem?.coluna.semantic).toBe("IN_PROGRESS");
    expect(origem?.coluna.is_default_target).toBe(false);
    expect(origem?.coluna.notify_deadline).toBe(true);
  });

  it("coluna que nao esta em quadro nenhum nao entra no indice", () => {
    // O caso NORMAL de `/arquivadas`, que lista o workspace inteiro paginado:
    // a tarefa pode viver num quadro que nao veio na lista.
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.get("nao-existe")).toBeUndefined();
  });

  it("cobre TODAS as colunas de TODOS os quadros", () => {
    const i = indiceDeColunas(QUADROS, "b-geral");
    expect(i.size).toBe(GERAL.length + AVULSO.length);
  });

  it("⚠️ sem quadro da tela, NENHUMA coluna e 'daqui'", () => {
    // `quadroDaTela = null` acontece quando nao ha quadro padrao. O indice
    // continua cheio, e toda coluna carrega o nome do quadro dela.
    const i = indiceDeColunas(QUADROS, null);
    expect(i.get("g3")?.nomeDoQuadro).toBe("Quadro geral");
    expect(i.get("a3")?.nomeDoQuadro).toBe("Campanhas");
  });
});

describe("rotuloDeColuna", () => {
  it("quadro da propria tela: so o nome da coluna", () => {
    expect(
      rotuloDeColuna({ coluna: GERAL[2], nomeDoQuadro: null }),
    ).toBe("Em Andamento");
  });

  it("outro quadro: as DUAS informacoes", () => {
    expect(
      rotuloDeColuna({ coluna: AVULSO[2], nomeDoQuadro: "Campanhas" }),
    ).toBe("Campanhas · Em Revisão");
  });

  it("⚠️ coluna desconhecida devolve null -- a reserva e do chamador", () => {
    // ⚠️ O MOTIVO DE ESTA FUNCAO TER MUDADO DE ASSINATURA NA 5b-5b. Na versao
    // anterior nao havia como dizer "nao sei qual coluna": o chamador tinha de
    // passar o rotulo do STATUS num parametro chamado `nomeDaColuna`, os dois
    // eram `string`, e o `tsc` aceitava calado. `null` na saida nao se parece
    // com rotulo nenhum, e obriga cada tela a escrever qual e a reserva dela.
    expect(rotuloDeColuna(undefined)).toBeNull();
  });

  it("⚠️ string vazia NAO e o mesmo que null", () => {
    // `null` significa "e o quadro desta tela". Quadro sem nome e outra coisa,
    // e a tela mostra o separador em vez de esconder o caso. O backend recusa
    // nome vazio (`BoardService._nome_valido`), entao isto nao vem da API --
    // esta aqui para que trocar `=== null` por um teste de veracidade
    // (`!nomeDoQuadro`) fique vermelho.
    expect(rotuloDeColuna({ coluna: GERAL[0], nomeDoQuadro: "" })).toBe(
      " · Backlog",
    );
  });
});
