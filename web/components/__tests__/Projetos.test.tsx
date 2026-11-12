// /projetos: a criação segue o time ativo e só oferece times em que a pessoa cria.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProjetosPage from "@/app/projetos/page";
import type { CurrentUser, Project, Team } from "@/lib/api";
import {
  ActiveTeamProvider,
  type ActiveTeamContext,
} from "@/lib/useActiveTeam";

// O mock fornece o contexto de time (como o `AppShell`). Variável mutável: a fábrica
// do `vi.mock` é içada, mas só o render a lê.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <ActiveTeamProvider value={contextoDoTeste}>{children}</ActiveTeamProvider>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listProjects: vi.fn(),
    createProject: vi.fn(),
    currentUser: vi.fn(),
    listTeamsAll: vi.fn(),
  };
});

const api = await import("@/lib/api");

const MKT = "team-marketing";
const COM = "team-comercial";

function time(id: string, name: string, criaProjeto = true): Team {
  // `can_create_project` ausente lê-se como "não": sem ele, nenhum time seria oferecido.
  return {
    id,
    workspace_id: "ws",
    parent_team_id: null,
    name,
    slug: id,
    can_create_project: criaProjeto,
  };
}

/** O contexto padrão: o Comercial ativo. Reposto no `afterEach`. */
const CONTEXTO_PADRAO: ActiveTeamContext = {
  active: { kind: "team", teamId: COM, fromUrl: true },
  search: `?time=${COM}`,
  teamName: "Comercial",
  teams: [],
};
let contextoDoTeste: ActiveTeamContext = CONTEXTO_PADRAO;

function projeto(over: Partial<Project> & { id: string; title: string }): Project {
  // Literal completo, sem `as`: o `as` cala o `tsc` sobre campo inexistente.
  return {
    description: "",
    status: "PLANNING",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    completed_at: null,
    team_id: COM,
    created_by: "user-1",
    created_at: "2026-09-14T12:00:00Z",
    updated_at: "2026-09-14T12:00:00Z",
    // Os botões vêm do servidor, no time do projeto.
    can_update: true,
    can_delete: true,
    ...over,
  };
}

function montar() {
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 100,
  });
  // Papel de organização e duas raízes: faz `rootsForPerson` devolver as duas e o campo "Time" aparecer.
  vi.mocked(api.currentUser).mockResolvedValue({
    id: "user-1",
    name: "Camila",
    email: "camila@t.dev",
    must_change_password: false,
    roles: [],
    permissions: ["project.create"],
    org_role: "ADMIN",
    teams: [],
  } as unknown as CurrentUser);
  vi.mocked(api.listTeamsAll).mockResolvedValue([
    time(COM, "Comercial"),
    time(MKT, "Marketing"),
  ]);
  render(<ProjetosPage />);
}

async function abrirNovoProjeto(): Promise<HTMLSelectElement> {
  // Com a lista vazia há dois botões com este texto; o primeiro é o do cabeçalho.
  const [doCabecalho] = await screen.findAllByText("+ Novo projeto");
  fireEvent.click(doCabecalho);
  return (await screen.findByLabelText("Time do projeto")) as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  contextoDoTeste = CONTEXTO_PADRAO;
});

describe("/projetos -- a criação segue o time ativo", () => {
  it("⚠️ o novo projeto já vem com o time ATIVO, e não vazio", async () => {
    montar();
    const campo = await abrirNovoProjeto();
    await waitFor(() => expect(campo.value).toBe(COM));
  });

  it("⚠️ criado para OUTRO time, NÃO entra na lista recortada", async () => {
    vi.mocked(api.createProject).mockResolvedValue(
      projeto({ id: "p-mkt", title: "Campanha do Marketing", team_id: MKT }),
    );
    montar();
    const campo = await abrirNovoProjeto();
    await waitFor(() => expect(campo.value).toBe(COM));

    fireEvent.change(campo, { target: { value: MKT } });
    fireEvent.change(screen.getByPlaceholderText("Ex.: Campanha Q3"), {
      target: { value: "Campanha do Marketing" },
    });
    fireEvent.click(screen.getByText("Criar projeto"));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: MKT }),
      ),
    );
    // A lista é a do Comercial: o projeto do Marketing não pode aparecer nela.
    await waitFor(() =>
      expect(screen.queryByText("Campanha do Marketing")).toBeNull(),
    );
  });

  it("criado para o time ativo, entra na lista na hora", async () => {
    vi.mocked(api.createProject).mockResolvedValue(
      projeto({ id: "p-com", title: "Metas do trimestre", team_id: COM }),
    );
    montar();
    const campo = await abrirNovoProjeto();
    await waitFor(() => expect(campo.value).toBe(COM));

    fireEvent.change(screen.getByPlaceholderText("Ex.: Campanha Q3"), {
      target: { value: "Metas do trimestre" },
    });
    fireEvent.click(screen.getByText("Criar projeto"));

    expect(await screen.findByText("Metas do trimestre")).toBeTruthy();
  });
});

describe("/projetos -- só oferece o time em que a pessoa CRIA", () => {
  it("⚠️ gerente no Marketing e operador no Comercial: o Comercial ativo não vira destino", async () => {
    // Alcança os dois times (`rootsForPerson`), mas só cria no Marketing: o Comercial ativo daria 403.
    vi.mocked(api.listProjects).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 100,
    });
    vi.mocked(api.currentUser).mockResolvedValue({
      id: "user-2",
      name: "Duas árvores",
      email: "duas@t.dev",
      must_change_password: false,
      roles: ["MANAGER", "OPERATOR"],
      permissions: ["project.create"],
      org_role: null,
      teams: [
        { team_id: MKT, role: "MANAGER" },
        { team_id: COM, role: "OPERATOR" },
      ],
    } as unknown as CurrentUser);
    vi.mocked(api.listTeamsAll).mockResolvedValue([
      time(COM, "Comercial", false),
      time(MKT, "Marketing", true),
    ]);
    vi.mocked(api.createProject).mockResolvedValue(
      projeto({ id: "p-mkt", title: "Campanha", team_id: MKT }),
    );
    render(<ProjetosPage />);

    const [doCabecalho] = await screen.findAllByText("+ Novo projeto");
    fireEvent.click(doCabecalho);
    fireEvent.change(await screen.findByPlaceholderText("Ex.: Campanha Q3"), {
      target: { value: "Campanha" },
    });
    // Um time só: o campo nem é desenhado.
    expect(screen.queryByLabelText("Time do projeto")).toBeNull();
    fireEvent.click(screen.getByText("Criar projeto"));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: MKT }),
      ),
    );
  });

  it("sem time nenhum em que crie, não há botão de novo projeto", async () => {
    vi.mocked(api.listProjects).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 100,
    });
    vi.mocked(api.currentUser).mockResolvedValue({
      id: "user-3",
      name: "Operadora",
      email: "op@t.dev",
      must_change_password: false,
      roles: ["OPERATOR"],
      permissions: [],
      org_role: null,
      teams: [{ team_id: COM, role: "OPERATOR" }],
    } as unknown as CurrentUser);
    vi.mocked(api.listTeamsAll).mockResolvedValue([time(COM, "Comercial", false)]);
    render(<ProjetosPage />);

    await waitFor(() => expect(api.listTeamsAll).toHaveBeenCalled());
    // Um tique para o `then` da busca assentar antes de afirmar a ausência.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("+ Novo projeto")).toBeNull();
  });
});
