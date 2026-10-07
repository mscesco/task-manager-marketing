// Spec 056, fatia E -- a lista de Bases e a tabela.
//
// ⚠️ O QUE ESTE ARQUIVO PRENDE É "OS BOTÕES VÊM DO SERVIDOR" (spec §5.6). Em
// todo teste o servidor é quem diz -- `can_create_base` por time, `can_restore`
// por item da lixeira, `can_*` por base --, e a tela tem de obedecer mesmo
// quando o "papel" sugeriria outra coisa. A regra pura (mover, interpretar,
// rótulo de pessoa) é testada em `lib/__tests__/baseTable.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";

import ListaDeBases from "@/components/bases/ListaDeBases";
import TabelaDaBase, { type Pessoas } from "@/components/bases/TabelaDaBase";
import type {
  BaseColumn,
  BaseDetail,
  BaseRow,
  BaseSummary,
  BaseTrashItem,
  Team,
} from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/bases",
}));

vi.mock("@/lib/useActiveTeam", () => ({
  useActiveTeamId: () => null,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listBases: vi.fn(),
    listBaseTrash: vi.fn(),
    listTeamsAll: vi.fn(),
    restoreBase: vi.fn(),
    updateBaseCells: vi.fn(),
    createBaseRow: vi.fn(),
  };
});

const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ------------------------------------------------------------------ lista

function raiz(id: string, name: string, criaBase: boolean): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: null,
    name,
    slug: id,
    can_create_base: criaBase,
  };
}

function resumo(id: string, team_id: string, name: string): BaseSummary {
  return { id, team_id, name, updated_at: "2026-10-07T12:00:00Z", can_update: true, can_delete: true };
}

describe("ListaDeBases", () => {
  it("agrupa por time raiz quando há mais de um, e só oferece criar onde o servidor deixa", async () => {
    vi.mocked(api.listBases).mockResolvedValue([
      resumo("b1", "mkt", "Calendário geral"),
      resumo("b2", "com", "Metas"),
    ]);
    vi.mocked(api.listTeamsAll).mockResolvedValue([
      raiz("mkt", "Marketing", true),
      raiz("com", "Comercial", false),
    ]);
    vi.mocked(api.listBaseTrash).mockResolvedValue([]);
    render(<ListaDeBases />);

    expect(await screen.findByText("Calendário geral")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Marketing" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Comercial" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Metas" }).getAttribute("href")).toBe("/bases/b2");

    fireEvent.click(screen.getByRole("button", { name: "Nova base" }));
    // ⚠️ Uma raiz só onde cria: sem seletor de time, e o Comercial não aparece.
    expect(screen.queryByLabelText("Time")).toBeNull();
  });

  it("⚠️ sem can_create_base em lugar nenhum, não há botão de criar", async () => {
    vi.mocked(api.listBases).mockResolvedValue([resumo("b1", "mkt", "Calendário")]);
    vi.mocked(api.listTeamsAll).mockResolvedValue([raiz("mkt", "Marketing", false)]);
    vi.mocked(api.listBaseTrash).mockRejectedValue(new api.ApiError(403, "sem permissão"));
    render(<ListaDeBases />);

    expect(await screen.findByText("Calendário")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova base" })).toBeNull();
    // e a lixeira (403) simplesmente não aparece -- não é erro
    expect(screen.queryByText("Lixeira")).toBeNull();
  });

  it("a lixeira restaura e a base volta para a lista", async () => {
    const item: BaseTrashItem = {
      id: "b9",
      team_id: "mkt",
      name: "Antiga",
      deleted_at: "2026-10-05T12:00:00Z",
      deleted_by: null,
      restorable_until: "2026-10-15T12:00:00Z",
      can_restore: true,
    };
    vi.mocked(api.listBases).mockResolvedValue([]);
    vi.mocked(api.listTeamsAll).mockResolvedValue([raiz("mkt", "Marketing", true)]);
    vi.mocked(api.listBaseTrash).mockResolvedValue([item]);
    vi.mocked(api.restoreBase).mockResolvedValue(detalhe({ id: "b9", name: "Antiga" }));
    render(<ListaDeBases />);

    expect(await screen.findByText(/volta até 15\/10\/2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
    expect(await screen.findByRole("link", { name: "Antiga" })).toBeTruthy();
    expect(screen.queryByText("Lixeira")).toBeNull();
  });
});

// ------------------------------------------------------------------ tabela

const TITULO: BaseColumn = {
  id: "c-titulo", name: "Título", type: "title", options: [], position: 1, width: null, version: 1,
};
const NUMERO: BaseColumn = {
  id: "c-num", name: "Alcance", type: "number", options: [], position: 2, width: null, version: 1,
};
const RESP: BaseColumn = {
  id: "c-resp", name: "Responsável", type: "person", options: [], position: 3, width: null, version: 1,
};

function detalhe(over: Partial<BaseDetail> = {}): BaseDetail {
  return {
    id: "b1",
    team_id: "mkt",
    name: "Calendário",
    updated_at: "",
    can_update: true,
    can_delete: true,
    description: "",
    created_by: "u1",
    created_at: "",
    columns: [TITULO, NUMERO, RESP],
    views: [],
    can_create_column: true,
    can_update_column: true,
    can_delete_column: true,
    can_create_row: true,
    can_update_row: true,
    can_delete_row: true,
    can_create_view: true,
    can_update_view: true,
    can_delete_view: true,
    ...over,
  };
}

function linha(id: string, values: BaseRow["values"]): BaseRow {
  return { id, values, version: 1, created_by: "u1", created_at: "", updated_at: "" };
}

const PESSOAS: Pessoas = {
  todos: new Map([
    ["ana", { name: "Ana", is_active: true }],
    ["bia", { name: "Bia", is_active: false }],
  ]),
  daArvore: new Set(["ana", "bia"]),
};

function Montada({ base, linhas: iniciais }: { base: BaseDetail; linhas: BaseRow[] }) {
  const [b, setB] = useState(base);
  const [ls, setLs] = useState(iniciais);
  const ocupado = useRef(false);
  return (
    <TabelaDaBase
      base={b}
      linhas={ls}
      pessoas={PESSOAS}
      noTeto={false}
      onBase={(f) => setB(f)}
      onLinhas={(f) => setLs(f)}
      ocupadoRef={ocupado}
    />
  );
}

describe("TabelaDaBase", () => {
  it("é uma grade: a célula ativa é a única com tabIndex 0, e as setas a movem", () => {
    render(<Montada base={detalhe()} linhas={[linha("r1", { "c-titulo": "Collab" })]} />);
    const grade = screen.getByRole("grid", { name: "Calendário" });
    const celulas = screen.getAllByRole("gridcell");
    expect(celulas.filter((c) => c.tabIndex === 0)).toHaveLength(1);

    celulas[0].focus();
    fireEvent.keyDown(celulas[0], { key: "ArrowRight" });
    expect(screen.getByRole("gridcell", { name: "Alcance, linha 1" }).tabIndex).toBe(0);
    expect(grade).toBeTruthy();
  });

  it("Enter edita, e Enter de novo grava SÓ a célula, com o valor interpretado", async () => {
    vi.mocked(api.updateBaseCells).mockResolvedValue([linha("r1", { "c-num": 1234.5 })]);
    render(<Montada base={detalhe()} linhas={[linha("r1", {})]} />);
    const celula = screen.getByRole("gridcell", { name: "Alcance, linha 1" });
    fireEvent.click(celula);
    fireEvent.keyDown(celula, { key: "Enter" });

    const campo = screen.getByLabelText("Editar Alcance");
    fireEvent.change(campo, { target: { value: "1.234,5" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateBaseCells).toHaveBeenCalledWith("b1", [
        { row_id: "r1", column_id: "c-num", value: 1234.5 },
      ])
    );
    // ⚠️ Uma chamada só. MAS ESTA LINHA NÃO PROVA A TRAVA `confirmado` da
    // tabela: o jsdom não dispara `blur` quando o campo sai da tela, e com a
    // trava desligada este teste continuou verde (sabotagem de 07/10). O caso
    // que ela protege -- o navegador mandando o blur depois do Enter -- fica no
    // smoke da fatia, no olho.
    expect(api.updateBaseCells).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("1234,5")).toBeTruthy();
  });

  it("Esc cancela sem gravar", () => {
    render(<Montada base={detalhe()} linhas={[linha("r1", { "c-titulo": "Collab" })]} />);
    const celula = screen.getByRole("gridcell", { name: "Título, linha 1" });
    fireEvent.click(celula);
    fireEvent.keyDown(celula, { key: "Enter" });
    const campo = screen.getByLabelText("Editar Título");
    fireEvent.change(campo, { target: { value: "Outro" } });
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(api.updateBaseCells).not.toHaveBeenCalled();
    expect(screen.getByText("Collab")).toBeTruthy();
  });

  it("pessoa desativada aparece com o rótulo, e não some (D8)", () => {
    render(<Montada base={detalhe()} linhas={[linha("r1", { "c-resp": ["ana", "bia"] })]} />);
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Bia (inativo)")).toBeTruthy();
  });

  it("⚠️ o servidor diz que não: sem nova linha, sem nova coluna, sem apagar, e a célula não edita", () => {
    render(
      <Montada
        base={detalhe({
          can_create_row: false,
          can_create_column: false,
          can_delete_row: false,
          can_update_row: false,
          can_update_column: false,
          can_delete_column: false,
        })}
        linhas={[linha("r1", { "c-titulo": "Collab" })]}
      />
    );
    expect(screen.queryByRole("button", { name: /Nova linha/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova coluna" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apagar a linha/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Opções da coluna/ })).toBeNull();

    const celula = screen.getByRole("gridcell", { name: "Título, linha 1" });
    fireEvent.click(celula);
    fireEvent.keyDown(celula, { key: "Enter" });
    expect(screen.queryByLabelText("Editar Título")).toBeNull();
  });
});
