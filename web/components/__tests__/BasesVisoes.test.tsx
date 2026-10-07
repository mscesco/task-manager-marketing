// Spec 056, fatia F -- as visões da Base: quadro, controles e abas.
//
// ⚠️ O QUE ESTE ARQUIVO PRENDE:
//   - o quadro tem um jeito de mover SEM arrastar (o seletor do card) -- a
//     violação aceita no quadro de tarefas (web/AGENTS.md §1) não se repete;
//   - sem `can_update_view`, os controles mostram a config mas não a mudam
//     (visão é compartilhada, D14);
//   - a visão padrão não oferece "Apagar visão" (D25).
// O que filtrar e ordenar significa é de `lib/__tests__/baseViews.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import BarraDeVisoes from "@/components/bases/BarraDeVisoes";
import ControlesDaVisao from "@/components/bases/ControlesDaVisao";
import QuadroDaBase from "@/components/bases/QuadroDaBase";
import type { BaseColumn, BaseDetail, BaseRow, BaseView } from "@/lib/api";
import { lerConfig } from "@/lib/baseViews";

afterEach(cleanup);

const TITULO: BaseColumn = {
  id: "t", name: "Título", type: "title", options: [], position: 1, width: null, version: 1,
};
const STATUS: BaseColumn = {
  id: "s", name: "Status", type: "select", position: 2, width: null, version: 1,
  options: [
    { id: "pub", label: "Publicado", color: "green" },
    { id: "can", label: "Cancelado", color: "red" },
  ],
};
const linha = (id: string, values: BaseRow["values"]): BaseRow => ({
  id, values, version: 1, created_by: "u", created_at: "", updated_at: "",
});

describe("QuadroDaBase", () => {
  it("uma coluna por opção e 'Sem valor'; mover pelo seletor grava a célula", () => {
    const onGravar = vi.fn();
    const linhas = [linha("a", { t: "Collab", s: "pub" }), linha("b", { t: "Live" })];
    render(
      <QuadroDaBase linhas={linhas} colunas={[TITULO, STATUS]} agrupar={STATUS} podeEditar onGravar={onGravar} />
    );
    expect(screen.getByRole("region", { name: "Publicado, 1" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sem valor, 1" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Mover "Collab" para'), { target: { value: "can" } });
    expect(onGravar).toHaveBeenCalledWith(linhas[0], STATUS, "can");

    fireEvent.change(screen.getByLabelText('Mover "Collab" para'), { target: { value: "" } });
    expect(onGravar).toHaveBeenLastCalledWith(linhas[0], STATUS, null);
  });

  it("sem permissão de editar: nem seletor, nem arraste", () => {
    render(
      <QuadroDaBase
        linhas={[linha("a", { t: "Collab", s: "pub" })]}
        colunas={[TITULO, STATUS]}
        agrupar={STATUS}
        podeEditar={false}
        onGravar={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Mover "Collab" para')).toBeNull();
    expect(screen.getByText("Collab").closest("li")?.getAttribute("draggable")).toBe("false");
  });
});

describe("ControlesDaVisao", () => {
  const props = {
    layout: "table" as const,
    colunas: [TITULO, STATUS],
    escolhasDe: () => [],
  };

  it("esconder coluna muda a config da visão", () => {
    const onConfig = vi.fn();
    render(<ControlesDaVisao {...props} config={lerConfig({})} podeEditar onConfig={onConfig} />);
    fireEvent.click(screen.getByRole("button", { name: /Colunas/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Status" }));
    expect(onConfig).toHaveBeenCalledWith(expect.objectContaining({ hidden_columns: ["s"] }));
  });

  it("⚠️ sem can_update_view a config aparece, mas não muda (D14)", () => {
    const onConfig = vi.fn();
    render(
      <ControlesDaVisao
        {...props}
        config={lerConfig({ filters: [{ column_id: "s", operator: "has_any", value: ["pub"] }] })}
        podeEditar={false}
        onConfig={onConfig}
      />
    );
    // o botão diz quantos filtros valem, para quem só olha
    fireEvent.click(screen.getByRole("button", { name: "Filtro (1)" }));
    expect(screen.queryByRole("button", { name: /Adicionar filtro/ })).toBeNull();
    expect((screen.getByLabelText("Coluna do filtro") as HTMLSelectElement).disabled).toBe(true);
  });
});

describe("BarraDeVisoes", () => {
  const visao = (id: string, padrao: boolean): BaseView => ({
    id, name: padrao ? "Tabela" : "Por status", layout: padrao ? "table" : "board",
    config: {}, position: padrao ? 1 : 2, is_default: padrao,
  });
  const base = (views: BaseView[]): BaseDetail => ({
    id: "b1", team_id: "mkt", name: "Calendário", updated_at: "", can_update: true,
    can_delete: true, description: "", created_by: "u", created_at: "", columns: [TITULO],
    views, can_create_column: true, can_update_column: true, can_delete_column: true,
    can_create_row: true, can_update_row: true, can_delete_row: true, can_create_view: true,
    can_update_view: true, can_delete_view: true,
  });

  it("as abas das visões, na ordem; a padrão não oferece apagar (D25)", () => {
    const views = [visao("p", true), visao("q", false)];
    render(<BarraDeVisoes base={base(views)} ativa={views[0]} onEscolher={vi.fn()} onViews={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Tabela", "Por status"]);
    fireEvent.click(screen.getByRole("button", { name: "Opções da visão Tabela" }));
    expect(screen.queryByRole("button", { name: "Apagar visão" })).toBeNull();
    expect(screen.getByText("A visão padrão não se apaga.")).toBeTruthy();
  });

  it("a outra visão oferece apagar", () => {
    const views = [visao("p", true), visao("q", false)];
    render(<BarraDeVisoes base={base(views)} ativa={views[1]} onEscolher={vi.fn()} onViews={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Opções da visão Por status" }));
    expect(screen.getByRole("button", { name: "Apagar visão" })).toBeTruthy();
  });
});
