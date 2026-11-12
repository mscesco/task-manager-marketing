// A página do projeto: excluir e navegação.
//
// O que ele prende:
//   - sem `can_delete`, não há botão (e ele NÃO vem junto de `can_update`);
//   - projeto PESSOAL nunca oferece o botão -- o backend recusa com 409;
//   - o excluir mora DENTRO do painel de edição, não solto no cabeçalho;
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
//
// ⚠️ MAS ELE PRECISA DESENHAR OS DOIS ENCAIXES: o lápis e o painel de edição
// chegam ao `Board` como `acoesDoTitulo` e `abaixoDoCabecalho` -- um dublê que
// os ignore esconde metade da tela e faz o arquivo inteiro falhar por motivo
// errado.
vi.mock("@/components/Board", () => ({
  default: ({
    acoesDoTitulo,
    abaixoDoCabecalho,
  }: {
    acoesDoTitulo?: React.ReactNode;
    abaixoDoCabecalho?: React.ReactNode;
  }) => (
    <div>
      quadro
      {acoesDoTitulo}
      {abaixoDoCabecalho}
    </div>
  ),
}));
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
    team_id: "team-1",
    created_by: "user-1",
    completed_at: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    // Os botões vêm do servidor, no time do projeto.
    can_update: true,
    can_delete: true,
    ...over,
  };
}

function montar(over: Partial<Project> = {}) {
  // ⚠️ SEM `currentUser`. Os botões vêm do PROJETO
  // (`can_update`, `can_delete`), calculados pelo servidor no time dele; a
  // página deixou de ler `me.permissions`, que diz "o que" e nunca "onde".
  vi.mocked(api.getProject).mockResolvedValue(projeto(over));
  render(<PaginaDoProjeto />);
}

/**
 * Abre o painel de edição, que é onde o excluir mora agora.
 *
 * ⚠️ SEM `project.update` NÃO HÁ LÁPIS, e portanto não há como chegar ao
 * excluir pela tela -- é uma consequência real da mudança de lugar, e o teste
 * de permissão abaixo a registra em vez de contorná-la.
 */
async function abrirEdicao() {
  fireEvent.click(await screen.findByLabelText("Editar projeto"));
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Projeto -- navegação", () => {
  it("⚠️ o link de VOLTAR existe e leva o time do projeto", async () => {
    montar();
    const voltar = await screen.findByText(/Projetos/);
    // ⚠️ COM O TIME DO PROJETO: sem o `?time=`, a lista cai na reserva e abre
    // os projetos de outro time. O fixture é do `team-1`.
    expect(voltar.getAttribute("href")).toBe("/projetos?time=team-1");
  });
});

describe("Projeto -- excluir", () => {
  it("⚠️ sem `can_delete` não há botão -- e ele não vem junto de `can_update`", async () => {
    montar({ can_delete: false });
    // Quem só pode EDITAR chega ao painel e não encontra o excluir lá dentro.
    await abrirEdicao();
    expect(screen.queryByText("Excluir projeto")).toBeNull();
  });

  it("⚠️ sem `can_update` não há lápis -- mesmo com a permissão em algum lugar", async () => {
    // Gerente no Marketing e operador no Comercial, abrindo um
    // projeto do Comercial. `me.permissions` tem `project.update`; o projeto diz
    // que ali não. Quem manda é o projeto.
    montar({ can_update: false, can_delete: false });
    // O "‹ Projetos" só aparece com o projeto carregado -- é a espera certa.
    await screen.findByText(/Projetos/);
    expect(screen.queryByLabelText("Editar projeto")).toBeNull();
  });

  it("⚠️ o excluir NÃO fica solto no cabeçalho -- só dentro da edição", async () => {
    // Fora do painel, a ação irreversível ficaria a um clique no meio da navegação.
    montar();
    await screen.findByLabelText("Editar projeto");
    expect(screen.queryByText("Excluir projeto")).toBeNull();
    await abrirEdicao();
    expect(screen.getByText("Excluir projeto")).toBeTruthy();
  });

  it("cancelar a confirmação não chama a API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    await abrirEdicao();
    fireEvent.click(screen.getByText("Excluir projeto"));
    expect(api.deleteProject).not.toHaveBeenCalled();
  });

  it("⚠️ o aviso DIZ o que acontece com as tarefas", async () => {
    // O soft delete marca `deleted_at` no PROJETO e não toca nelas: elas
    // continuam no quadro e só perdem a tag. Quem lê "excluir projeto" imagina
    // o contrário, e a diferença é grande demais para ficar implícita.
    montar();
    await abrirEdicao();
    fireEvent.click(screen.getByText("Excluir projeto"));
    const texto = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(texto).toMatch(/tarefas dele NÃO são apagadas/i);
  });

  it("confirmar exclui e SAI da página com `replace`", async () => {
    // ⚠️ `replace` e não `push`: a página do projeto apagado não pode sobrar no
    // histórico -- o "voltar" cairia num 404.
    vi.mocked(api.deleteProject).mockResolvedValue(projeto());
    montar();
    await abrirEdicao();
    fireEvent.click(screen.getByText("Excluir projeto"));

    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith("p1"));
    // ⚠️ Mesma coisa ao excluir: sai para a lista DO TIME do projeto.
    expect(replace).toHaveBeenCalledWith("/projetos?time=team-1");
  });

  it("o 403 do servidor aparece na tela, e a página não sai", async () => {
    const err = Object.assign(new Error("nao pode"), { status: 403 });
    vi.mocked(api.deleteProject).mockRejectedValue(err);
    montar();
    await abrirEdicao();
    fireEvent.click(screen.getByText("Excluir projeto"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/não pode excluir este projeto/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
