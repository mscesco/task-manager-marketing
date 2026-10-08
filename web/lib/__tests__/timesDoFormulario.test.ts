import { describe, expect, it } from "vitest";
import type { Team } from "@/lib/api";
import { timePadraoDoFormulario, timesQueCriamFormulario } from "@/lib/timesDoFormulario";

const time = (id: string, pai: string | null, cria?: boolean): Team => ({
  id, workspace_id: "w", parent_team_id: pai, name: id, slug: id, can_create_form: cria,
});
// O gestor do Marketing: cria no Marketing e nos subtimes dele, nao no Comercial.
const TIMES = [
  time("mkt", null, true), time("design", "mkt", true),
  time("com", null, false), time("vendas", "com"),
];

describe("timesQueCriamFormulario", () => {
  it("so os que o servidor libera -- subtime entra, o Comercial nao", () => {
    expect(timesQueCriamFormulario(TIMES).map((t) => t.id)).toEqual(["mkt", "design"]);
  });
});

describe("timePadraoDoFormulario", () => {
  it("o time ativo, quando a pessoa cria nele", () => {
    expect(timePadraoDoFormulario(TIMES, "design")).toBe("design");
  });
  it("⚠️ o ativo em que ela NAO cria nao vem pre-escolhido -- cai na raiz em que cria", () => {
    expect(timePadraoDoFormulario(TIMES, "com")).toBe("mkt");
  });
  it("sem ativo: a UNICA raiz em que cria -- subtime nao conta", () => {
    expect(timePadraoDoFormulario(TIMES, null)).toBe("mkt");
  });
  it("⚠️ duas raizes em que cria: nenhuma -- nunca a primeira da lista", () => {
    const duas = [time("com", null, true), time("mkt", null, true)];
    expect(timePadraoDoFormulario(duas, null)).toBe("");
  });
});
