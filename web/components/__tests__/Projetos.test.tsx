// /projetos -- a criação segue o time ativo (Spec 048, defeito de 14/09).
//
// ⚠️ ESTA TELA NÃO TINHA TESTE DE COMPONENTE NENHUM. Os dois defeitos abaixo
// viveram nela sem ninguém para gritar:
//
//   1. o seletor de time do "Novo projeto" só se preenchia com UMA área. Com
//      duas ficava vazio, ignorando que a pessoa estava no Comercial -- embora
//      o próprio comentário da tela já tivesse decidido o contrário ("quando a
//      área ambiente existir, este seletor passa a ser confirmação do lugar
//      onde a pessoa já está");
//   2. o projeto recém-criado entrava na lista na hora, mesmo sendo de OUTRO
//      time. Com a lista recortada, ele aparecia "em Comercial" sendo do
//      Marketing, até recarregar.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProjetosPage from "@/app/projetos/page";
import type { CurrentUser, Project, Team } from "@/lib/api";
import {
  ActiveTeamProvider,
  type ActiveTeamContext,
} from "@/lib/useActiveTeam";

// ⚠️ O MOCK FORNECE O CONTEXTO DE TIME, porque o `AppShell` de verdade fornece.
// Variável mutável pelo mesmo motivo de `Formularios.test.tsx`: a fábrica do
// `vi.mock` é içada, e ela não LÊ a variável (só o corpo do componente, no
// render) -- sem TDZ.
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
  // ⚠️ Spec 051, fatia A: `can_create_project` vem do servidor, e AUSENTE
  // LÊ-SE COMO "NÃO" -- sem ele aqui, nenhuma área seria oferecida.
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
  // Literal completo, SEM `as` -- fixture com `as` cala o `tsc` sobre campo
  // que não existe.
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
    // Spec 051, fatia A: os botões vêm do servidor, no time do projeto.
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
  // ⚠️ PAPEL DE ORGANIZAÇÃO e DUAS raízes: é o que faz `rootsForPerson` devolver
  // as duas e o campo "Time" aparecer. Com uma só, o campo nem é desenhado.
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
  // ⚠️ DOIS BOTÕES COM ESTE TEXTO quando a lista está vazia: o do cabeçalho e o
  // do aviso de vazio. O primeiro na ordem do documento é o do cabeçalho.
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

describe("/projetos -- só oferece a área em que a pessoa CRIA (Spec 051, fatia A)", () => {
  it("⚠️ gerente no Marketing e operador no Comercial: o Comercial ativo não vira destino", async () => {
    // O caso da fatia. Ela alcança as duas áreas (`rootsForPerson`) e tem
    // `project.create` em algum lugar -- mas só cria no Marketing. Antes, o
    // campo vinha preenchido com o Comercial (o time ativo) e o POST dava 403.
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
    // Uma área só: não há pergunta, e o campo nem é desenhado.
    expect(screen.queryByLabelText("Time do projeto")).toBeNull();
    fireEvent.click(screen.getByText("Criar projeto"));

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ team_id: MKT }),
      ),
    );
  });

  it("sem área nenhuma em que crie, não há botão de novo projeto", async () => {
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
