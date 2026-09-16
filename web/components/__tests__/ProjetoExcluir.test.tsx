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
//
// ⚠️ E ELE VIROU O ARQUIVO DA PÁGINA, e não só do excluir: o teste de
// navegação abaixo entrou aqui porque esta página não tinha teste NENHUM até
// o excluir chegar. Criar um segundo arquivo para uma asserção só seria pior
// que a mistura.
//
// ⚠️ O BOTÃO MUDOU DE LUGAR EM 22/08 e estes testes CAÍRAM -- que é o trabalho
// deles. Ele era um botão vermelho no cabeçalho, ao lado de "Editar"; passou a
// morar DENTRO do painel de edição, por decisão da Camila ("só tem um lápis de
// edição, que é pra editar o projeto e ali dentro já deixa o excluir"). Uma
// ação irreversível a um clique da navegação virou uma ação que exige abrir a
// edição primeiro.

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
// ⚠️ MAS ELE PRECISA DESENHAR OS DOIS ENCAIXES (22/08). Desde que o cabeçalho
// do projeto virou o cabeçalho do próprio quadro, o lápis e o painel de edição
// chegam ao `Board` como `acoesDoTitulo` e `abaixoDoCabecalho` -- um dublê que
// os ignore esconde metade da tela e faz o arquivo inteiro falhar por motivo
// errado. Foi o que aconteceu quando a mudança entrou.
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
    is_archived: false,
    team_id: "team-1",
    created_by: "user-1",
    completed_at: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
    // Spec 051, fatia A: os botões vêm do servidor, no time do projeto.
    can_update: true,
    can_archive: true,
    can_delete: true,
    ...over,
  };
}

function montar(over: Partial<Project> = {}) {
  // ⚠️ Spec 051, fatia A: SEM `currentUser`. Os botões vêm do PROJETO
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
  it("⚠️ o link de VOLTAR existe -- eu o apaguei sem querer em 22/08", async () => {
    // ⚠️ ESTE TESTE EXISTE POR UMA REGRESSÃO MINHA, e ela passou pelos quatro
    // portões. Ao refazer o cabeçalho do projeto (o nome aparecia duas vezes),
    // apaguei o bloco que a página desenhava -- e o "‹ Projetos" morava dentro
    // dele. Saiu junto, em silêncio: nenhum teste desta página falava de
    // navegação, e `tsc`/`build` não têm opinião sobre link que sumiu.
    //
    // A Camila pegou na tela no mesmo dia: "você tirou o 'voltar' da tela
    // quando abre um projeto né".
    montar();
    const voltar = await screen.findByText(/Projetos/);
    // ⚠️ COM O TIME DO PROJETO (14/09): o caminho puro apagava o `?time=` e a
    // lista caía na reserva -- voltando de um projeto do Comercial, abria os do
    // Marketing. O fixture é do `team-1`.
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

  it("⚠️ Spec 051: sem `can_update` não há lápis -- mesmo com a permissão em algum lugar", async () => {
    // O caso da fatia: gerente no Marketing e operador no Comercial, abrindo um
    // projeto do Comercial. `me.permissions` tem `project.update`; o projeto diz
    // que ali não. Quem manda é o projeto.
    montar({ can_update: false, can_delete: false });
    // O "‹ Projetos" só aparece com o projeto carregado -- é a espera certa.
    await screen.findByText(/Projetos/);
    expect(screen.queryByLabelText("Editar projeto")).toBeNull();
  });

  it("⚠️ o excluir NÃO fica solto no cabeçalho -- só dentro da edição", async () => {
    // O que este teste prende é o LUGAR, e ele é a decisão: fora do painel, a
    // ação irreversível ficava a um clique de distância no meio da navegação.
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
