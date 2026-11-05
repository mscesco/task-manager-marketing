/**
 * Spec 062 -- o modal "Mover…": a busca de "Subtarefa de…", a previa do
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
  saem: [{ user_id: "gi", nome: "Gi", tarefas: 2 }], assume: 0,
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
