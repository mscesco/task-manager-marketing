// Excluir projeto -- a metade da tela que nunca existiu.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. Camila, 22/08: "não dá pra excluir projeto".
// Não havia defeito no backend: `DELETE /projects/{id}` está lá desde sempre,
// com permissão `project.delete` e a recusa do projeto pessoal (409). O que
// faltava era a tela -- e **nenhum portão podia pegar isso**, porque não há
// teste para "rota de API sem chamador nenhum". O `archiveProject` e o
// `unarchiveProject` continuam nessa situação hoje.
//
// O que ele prende:
//   - sem `project.delete`, não há botão (e ele NÃO vem junto de `.update`);
//   - projeto PESSOAL nunca oferece o botão -- o backend recusa com 409;
//   - cancelar a confirmação não chama a API;
//   - confirmar chama e sai da página com `replace`, não `push`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import PaginaDoProjeto from "@/app/projetos/[id]/page";
import type { Project } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "p1" }),
  useRouter: () => ({ replace, push: vi.fn() }),
}));

// ⚠️ O `Board` É MOCKADO, e não é preguiça: ele busca colunas, quadros,
// membros e tarefas, e nada disso é o assunto aqui. Montá-lo de verdade faria
// este arquivo falhar por motivos que não têm relação com excluir projeto.
vi.mock("@/components/Board", () => ({ default: () => <div>quadro</div> }));
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    getProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    currentUser: vi.fn(),
  };
});

const api = await import("@/lib/api");

function projeto(over: Partial<Project> = {}): Project {
  // ⚠️ Literal completo, SEM `as`. Eu escrevi este comentário e usei `as
  // Project` na mesma função -- o `as` teria calado o `tsc` sobre o
  // `completed_at` que faltava. Fica registrado porque é a armadilha exata que
  // o comentário descreve.
  return {
    id: "p1",
    title: "Vestibular 2027",
    description: "",
    status: "ACTIVE",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    is_archived: false,
    is_personal: false,
    team_id: "team-1",
    created_by: "user-1",
    completed_at: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    ...over,
  };
}

function montar(over: Partial<Project> = {}, permissoes: string[] = ["project.delete"]) {
  vi.mocked(api.getProject).mockResolvedValue(projeto(over));
  vi.mocked(api.currentUser).mockResolvedValue({
    permissions: permissoes,
  } as never);
  render(<PaginaDoProjeto />);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Projeto -- excluir", () => {
  it("⚠️ sem `project.delete` não há botão -- e ela não vem junto de `.update`", async () => {
    montar({}, ["project.update"]);
    expect(await screen.findByText("Vestibular 2027")).toBeTruthy();
    // Editar aparece; excluir não.
    expect(screen.getByText("Editar")).toBeTruthy();
    expect(screen.queryByText("Excluir projeto")).toBeNull();
  });

  it("⚠️ projeto PESSOAL não oferece o botão -- o backend recusa com 409", async () => {
    // A trava dupla é de propósito: sem ela a tela ofereceria uma ação que
    // sempre falha, e a pessoa descobriria pelo erro.
    montar({ is_personal: true });
    expect(await screen.findByText("Vestibular 2027")).toBeTruthy();
    expect(screen.queryByText("Excluir projeto")).toBeNull();
  });

  it("cancelar a confirmação não chama a API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    fireEvent.click(await screen.findByText("Excluir projeto"));
    expect(api.deleteProject).not.toHaveBeenCalled();
  });

  it("⚠️ o aviso DIZ o que acontece com as tarefas", async () => {
    // O soft delete marca `deleted_at` no PROJETO e não toca nelas: elas
    // continuam no quadro e só perdem a tag. Quem lê "excluir projeto" imagina
    // o contrário, e a diferença é grande demais para ficar implícita.
    montar();
    fireEvent.click(await screen.findByText("Excluir projeto"));
    const texto = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(texto).toMatch(/tarefas dele NÃO são apagadas/i);
  });

  it("confirmar exclui e SAI da página com `replace`", async () => {
    // ⚠️ `replace` e não `push`: a página do projeto apagado não pode sobrar no
    // histórico -- o "voltar" cairia num 404.
    vi.mocked(api.deleteProject).mockResolvedValue(projeto());
    montar();
    fireEvent.click(await screen.findByText("Excluir projeto"));

    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith("p1"));
    expect(replace).toHaveBeenCalledWith("/projetos");
  });

  it("o 403 do servidor aparece na tela, e a página não sai", async () => {
    const err = Object.assign(new Error("nao pode"), { status: 403 });
    vi.mocked(api.deleteProject).mockRejectedValue(err);
    montar();
    fireEvent.click(await screen.findByText("Excluir projeto"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/não pode excluir este projeto/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
