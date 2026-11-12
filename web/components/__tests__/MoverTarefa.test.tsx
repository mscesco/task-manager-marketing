/**
 * O modal "Mover…": a busca de "Subtarefa de…", a previa do
 * servidor e o corpo que o "Mover" manda. As regras (destinos, frases) sao de
 * `lib/moverTarefa.ts` e tem teste proprio; aqui so a montagem.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import MoverTarefa from "@/components/MoverTarefa";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listBoards: vi.fn(),
    listTeamsAll: vi.fn(),
    searchBoardTasks: vi.fn(),
    relocateTask: vi.fn(),
  };
});

const api = await import("@/lib/api");

const PREVIA = {
  task: null, mudou: true, subtarefas: 1, projeto_antes: null, projeto_depois: null,
  saem: [{ user_id: "gi", nome: "Gi", tarefas: 2 }], assume: 0, status_muda: [],
};

beforeEach(() => {
  vi.mocked(api.listBoards).mockResolvedValue([
    { id: "g-mkt", name: "Geral", team_id: "mkt", is_default: true, colunas: [] },
  ]);
  vi.mocked(api.listTeamsAll).mockResolvedValue([
    { id: "mkt", name: "Marketing", parent_team_id: null, workspace_id: "ws", slug: "mkt" },
  ]);
  vi.mocked(api.searchBoardTasks).mockResolvedValue([
    { id: "neta", title: "Instagram", team_id: "mkt", depth: 2, caminho: ["Natal", "Redes"] },
  ]);
  vi.mocked(api.relocateTask).mockImplementation(async (_id, _corpo, dry) =>
    dry ? PREVIA : { ...PREVIA, task: { id: "t" } as never },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("escolhe a tarefa principal pela busca, mostra a previa e move", async () => {
  const onMovida = vi.fn();
  render(
    <MoverTarefa
      task={{ id: "t", title: "Arte", board_id: "g-mkt", team_id: "mkt", parent_task_id: null }}
      onMovida={onMovida}
      onFechar={vi.fn()}
    />,
  );

  fireEvent.click(await screen.findByLabelText("Subtarefa de…"));
  const achado = await screen.findByRole("button", { name: /Instagram/ });
  expect(achado.textContent).toBe("Natal › Redes › Instagram");
  expect(api.searchBoardTasks).toHaveBeenCalledWith("g-mkt", "", "t");

  fireEvent.click(achado);
  expect(
    await screen.findByText("Gi não vê o destino e sai de 2 tarefas (recebe um aviso)."),
  ).toBeTruthy();
  expect(api.relocateTask).toHaveBeenLastCalledWith("t", { parent_task_id: "neta" }, true);

  fireEvent.click(screen.getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(onMovida).toHaveBeenCalled());
  expect(api.relocateTask).toHaveBeenLastCalledWith("t", { parent_task_id: "neta" }, false);
});

it("no lugar onde ja esta, o Mover fica desligado e a tela diz por que", async () => {
  vi.mocked(api.relocateTask).mockResolvedValue({ ...PREVIA, mudou: false });
  render(
    <MoverTarefa
      task={{ id: "t", title: "Arte", board_id: "g-mkt", team_id: "mkt", parent_task_id: null }}
      onMovida={vi.fn()}
      onFechar={vi.fn()}
    />,
  );
  expect(await screen.findByText("A tarefa já está nesse lugar.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Mover" }) as HTMLButtonElement).disabled).toBe(true);
});

const TAREFA = { id: "t", title: "Arte", board_id: "g-mkt", team_id: "mkt", parent_task_id: null };

it("depois de um Mover que falhou, da para tentar de novo", async () => {
  vi.mocked(api.relocateTask).mockImplementation(async (_id, _corpo, dry) => {
    if (dry) return PREVIA;
    throw new Error("rede caiu");
  });
  render(<MoverTarefa task={TAREFA} onMovida={vi.fn()} onFechar={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText("Subtarefa de…"));
  fireEvent.click(await screen.findByRole("button", { name: /Instagram/ }));
  const botao = (await screen.findByRole("button", { name: "Mover" })) as HTMLButtonElement;
  await waitFor(() => expect(botao.disabled).toBe(false));

  fireEvent.click(botao);
  expect(await screen.findByRole("alert")).toBeTruthy();
  await waitFor(() => expect(botao.disabled).toBe(false));
});

it("buscar de novo desfaz a escolha que sumiu da lista", async () => {
  render(<MoverTarefa task={TAREFA} onMovida={vi.fn()} onFechar={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText("Subtarefa de…"));
  fireEvent.click(await screen.findByRole("button", { name: /Instagram/ }));
  await screen.findByText("Gi não vê o destino e sai de 2 tarefas (recebe um aviso).");

  fireEvent.change(screen.getByLabelText("Buscar a tarefa principal"), {
    target: { value: "Natal" },
  });
  expect(await screen.findByText("Escolha a tarefa principal.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Mover" }) as HTMLButtonElement).disabled).toBe(true);
});

it("o Esc durante o Movendo… nao escapa para o detalhe", async () => {
  vi.mocked(api.relocateTask).mockImplementation(async (_id, _corpo, dry) =>
    dry ? PREVIA : new Promise(() => {}),
  );
  const escNoDetalhe = vi.fn();
  window.addEventListener("keydown", escNoDetalhe);
  try {
    render(<MoverTarefa task={TAREFA} onMovida={vi.fn()} onFechar={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText("Subtarefa de…"));
    fireEvent.click(await screen.findByRole("button", { name: /Instagram/ }));
    const botao = (await screen.findByRole("button", { name: "Mover" })) as HTMLButtonElement;
    await waitFor(() => expect(botao.disabled).toBe(false));
    fireEvent.click(botao);
    await screen.findByRole("button", { name: /Movendo/ });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(escNoDetalhe).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", escNoDetalhe);
  }
});
