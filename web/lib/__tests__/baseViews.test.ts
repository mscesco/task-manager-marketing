import { describe, expect, it } from "vitest";
import type { BaseColumn, BaseRow, BaseView } from "@/lib/api";
import {
  agruparNoQuadro,
  aplicarVisao,
  colunasVisiveis,
  deslocamentos,
  diaDaSemana,
  quantasCongeladas,
  lerConfig,
  linhasPorDia,
  mesVizinho,
  passa,
  semanasDoMes,
  visaoAtiva,
  type ConfigDaVisao,
} from "@/lib/baseViews";

const col = (id: string, type: BaseColumn["type"], options: BaseColumn["options"] = []): BaseColumn => ({
  id, name: id, type, options, position: 1, width: null, version: 1,
});
const TITULO = col("t", "title");
const DATA = col("d", "date");
const NUM = col("n", "number");
const STATUS = col("s", "select", [
  { id: "pub", label: "Publicado", color: "green" },
  { id: "can", label: "Cancelado", color: "red" },
]);
const COLUNAS = [TITULO, DATA, NUM, STATUS];

const linha = (id: string, values: BaseRow["values"]): BaseRow => ({
  id, values, version: 1, created_by: "u", created_at: "", updated_at: "",
});
const LINHAS = [
  linha("a", { t: "Collab Will", d: "2026-08-01", n: 10, s: "pub" }),
  linha("b", { t: "Dia da Saúde", d: "2026-08-05", s: "can" }),
  linha("c", { t: "Live Carreiras", n: 3 }),
];

const vazia: ConfigDaVisao = {
  filters: [], sorts: [], hidden_columns: [], group_by: null, date_column: null,
  frozen_column: null,
};

describe("lerConfig", () => {
  it("normaliza, e ignora o que não tem a forma esperada", () => {
    const c = lerConfig({
      filters: [{ column_id: "s", operator: "has_any", value: ["pub"] }, { lixo: 1 }],
      sorts: [{ column_id: "d", direction: "desc" }, { column_id: "x", direction: "lado" }],
      hidden_columns: ["n", 3],
      group_by: "s",
    });
    expect(c.filters).toHaveLength(1);
    expect(c.sorts).toEqual([{ column_id: "d", direction: "desc" }]);
    expect(c.hidden_columns).toEqual(["n"]);
    expect(c.group_by).toBe("s");
    expect(c.date_column).toBeNull();
  });
  it("config ausente abre como vazia", () => {
    expect(lerConfig(undefined)).toEqual(vazia);
  });
});

describe("passa (filtro)", () => {
  it("texto contém, sem diferenciar maiúscula", () => {
    expect(passa(TITULO, "Collab Will", { column_id: "t", operator: "contains", value: "will" })).toBe(true);
  });
  it("seleção: qualquer um de / nenhum de", () => {
    const f = { column_id: "s", operator: "has_any" as const, value: ["pub"] };
    expect(passa(STATUS, "pub", f)).toBe(true);
    expect(passa(STATUS, "can", f)).toBe(false);
    expect(passa(STATUS, "can", { ...f, operator: "has_none" })).toBe(true);
  });
  it("data antes/depois, como string AAAA-MM-DD", () => {
    expect(passa(DATA, "2026-08-01", { column_id: "d", operator: "before", value: "2026-08-03" })).toBe(true);
    expect(passa(DATA, undefined, { column_id: "d", operator: "after", value: "2026-08-03" })).toBe(false);
  });
  it("⚠️ filtro sem valor NÃO filtra -- a pessoa ainda está escrevendo", () => {
    expect(passa(TITULO, "x", { column_id: "t", operator: "contains", value: "" })).toBe(true);
  });
  it("vazio / não vazio", () => {
    expect(passa(NUM, undefined, { column_id: "n", operator: "is_empty" })).toBe(true);
    expect(passa(NUM, 0, { column_id: "n", operator: "is_empty" })).toBe(false);
  });
});

describe("aplicarVisao", () => {
  it("filtros combinam com E", () => {
    const r = aplicarVisao(LINHAS, COLUNAS, {
      ...vazia,
      filters: [
        { column_id: "n", operator: "not_empty" },
        { column_id: "s", operator: "has_any", value: ["pub"] },
      ],
    });
    expect(r.map((l) => l.id)).toEqual(["a"]);
  });
  it("⚠️ vazio fica no fim nas DUAS direções", () => {
    const asc = aplicarVisao(LINHAS, COLUNAS, { ...vazia, sorts: [{ column_id: "d", direction: "asc" }] });
    const desc = aplicarVisao(LINHAS, COLUNAS, { ...vazia, sorts: [{ column_id: "d", direction: "desc" }] });
    expect(asc.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(desc.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });
  it("seleção ordena pela ordem das opções, não pelo alfabeto", () => {
    const r = aplicarVisao(LINHAS, COLUNAS, { ...vazia, sorts: [{ column_id: "s", direction: "asc" }] });
    expect(r.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("número ordena como número", () => {
    const r = aplicarVisao(LINHAS, COLUNAS, { ...vazia, sorts: [{ column_id: "n", direction: "asc" }] });
    expect(r.map((l) => l.id)).toEqual(["c", "a", "b"]);
  });
  it("filtro de coluna que não existe mais é ignorado", () => {
    const r = aplicarVisao(LINHAS, COLUNAS, {
      ...vazia,
      filters: [{ column_id: "apagada", operator: "is_empty" }],
    });
    expect(r).toHaveLength(3);
  });
  it("a linha recém-criada passa pelo filtro, para não sumir ao nascer", () => {
    const nova = linha("nova", {});
    const r = aplicarVisao([...LINHAS, nova], COLUNAS, {
      ...vazia,
      filters: [{ column_id: "s", operator: "has_any", value: ["pub"] }],
    }, { fixadas: new Set(["nova"]) });
    expect(r.map((l) => l.id)).toEqual(["a", "nova"]);
  });
});

describe("colunasVisiveis", () => {
  it("esconde as pedidas, mas nunca o título", () => {
    const r = colunasVisiveis(COLUNAS, { ...vazia, hidden_columns: ["t", "n"] });
    expect(r.map((c) => c.id)).toEqual(["t", "d", "s"]);
  });
});

describe("agruparNoQuadro", () => {
  it("uma coluna por opção, na ordem, e 'Sem valor' no fim", () => {
    const g = agruparNoQuadro(LINHAS, STATUS);
    expect(g.map((x) => x.rotulo)).toEqual(["Publicado", "Cancelado", "Sem valor"]);
    expect(g[2].linhas.map((l) => l.id)).toEqual(["c"]);
  });
  it("opção apagada conta como sem valor (D17)", () => {
    const g = agruparNoQuadro([linha("x", { s: "apagada" })], STATUS);
    expect(g[2].linhas.map((l) => l.id)).toEqual(["x"]);
  });
});

describe("calendário (sem Date)", () => {
  it("dia da semana", () => {
    expect(diaDaSemana(2026, 10, 7)).toBe(3); // quarta-feira
    expect(diaDaSemana(2026, 8, 1)).toBe(6); // sábado
    expect(diaDaSemana(2028, 2, 29)).toBe(2); // terça, ano bissexto
  });
  it("as semanas de agosto de 2026 começam num sábado", () => {
    const s = semanasDoMes(2026, 8);
    expect(s[0]).toEqual([null, null, null, null, null, null, "2026-08-01"]);
    expect(s.every((sem) => sem.length === 7)).toBe(true);
    expect(s.flat().filter(Boolean)).toHaveLength(31);
  });
  it("mês vizinho vira o ano", () => {
    expect(mesVizinho(2026, 12, 1)).toEqual({ ano: 2027, mes: 1 });
    expect(mesVizinho(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 });
  });
  it("linhas por dia, e as sem data à parte", () => {
    const { porDia, semData } = linhasPorDia(LINHAS, DATA);
    expect(porDia.get("2026-08-05")?.map((l) => l.id)).toEqual(["b"]);
    expect(semData.map((l) => l.id)).toEqual(["c"]);
  });
});

describe("congelar (fatia I)", () => {
  it("sem escolha, só o título", () => {
    expect(quantasCongeladas(COLUNAS, vazia)).toBe(1);
  });
  it("até a coluna escolhida, inclusive", () => {
    expect(quantasCongeladas(COLUNAS, { ...vazia, frozen_column: "n" })).toBe(3);
  });
  it("a congelada sumiu ou foi ocultada: volta a só o título", () => {
    expect(quantasCongeladas(COLUNAS, { ...vazia, frozen_column: "apagada" })).toBe(1);
  });
  it("o deslocamento de cada uma é a soma das anteriores", () => {
    expect(deslocamentos([240, 160, 200])).toEqual([0, 240, 400]);
  });
  it("lerConfig lê o frozen_column", () => {
    expect(lerConfig({ frozen_column: "d" }).frozen_column).toBe("d");
  });
});

describe("visaoAtiva", () => {
  const v = (id: string, padrao = false): BaseView => ({
    id, name: id, layout: "table", config: {}, position: 1, is_default: padrao,
  });
  it("a pedida, senão a padrão", () => {
    const views = [v("a"), v("p", true)];
    expect(visaoAtiva(views, "a")?.id).toBe("a");
    expect(visaoAtiva(views, "sumiu")?.id).toBe("p");
    expect(visaoAtiva(views, null)?.id).toBe("p");
  });
});
