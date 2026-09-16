// Spec 052, fatia D -- título, descrição e links editados NO LUGAR, no detalhe
// da tarefa, no gesto do Trello que ela pediu em 16/09.
//
// O que ele prende:
//   - título: clique abre; Enter salva; clicar fora (blur) salva; Esc desiste
//     SEM fechar o modal; vazio volta ao original; erro reabre com o texto;
//   - descrição: "Editar" só com texto; Enter quebra linha e NÃO salva;
//     Ctrl+Enter salva; clicar fora salva UMA vez; Cancelar e Esc não salvam;
//   - links: clicar fora salva; link com erro NÃO salva e o editor fica;
//     sem mudança não envia (estes dois vieram do antigo modal de editar);
//   - ⭐ o detalhe não tem mais o "Editar" do rodapé, e o título salvo continua
//     na tela MESMO QUANDO O PAI NÃO APLICA a resposta (`/tarefa/[id]`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TituloEditavel from "@/components/TituloEditavel";
import DescricaoEditavel from "@/components/DescricaoEditavel";
import LinksEditaveis from "@/components/LinksEditaveis";
import TaskDetail from "@/components/TaskDetail";
import type { Coluna } from "@/lib/coluna";
import type { Task } from "@/lib/api";
import type { Editor } from "@tiptap/core";
import { prepararEditorNoJsdom } from "./editorNoJsdom";

prepararEditorNoJsdom();

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    colunasDoQuadro: vi.fn(),
    listarFilhas: vi.fn(),
    listComments: vi.fn(),
    currentUser: vi.fn(),
    listMembersDoTime: vi.fn(),
    listProjects: vi.fn(),
    getRootTeamId: vi.fn(),
    updateTask: vi.fn(),
    getTaskLinks: vi.fn(),
    putTaskLinks: vi.fn(),
  };
});

const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** O Esc que chega à janela é o que fecha o modal do detalhe. */
function espiarEscNaJanela() {
  const espiao = vi.fn();
  const ouvinte = (e: KeyboardEvent) => {
    if (e.key === "Escape") espiao();
  };
  window.addEventListener("keydown", ouvinte);
  return { espiao, parar: () => window.removeEventListener("keydown", ouvinte) };
}

// ------------------------------------------------------------------ título

describe("TituloEditavel", () => {
  it("⭐ clique abre o campo; Enter salva uma vez e fecha", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<TituloEditavel valor="Arte" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título/ }));
    const campo = screen.getByLabelText("Título da tarefa") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(campo);
    fireEvent.change(campo, { target: { value: "Arte do CBV" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    fireEvent.blur(campo);
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("Arte do CBV"));
    expect(onSalvar).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Título da tarefa")).toBeNull();
  });

  it("clicar fora (blur) salva", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<TituloEditavel valor="Arte" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título/ }));
    const campo = screen.getByLabelText("Título da tarefa");
    fireEvent.change(campo, { target: { value: "Arte 2" } });
    fireEvent.blur(campo);
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("Arte 2"));
  });

  it("⚠️ Esc desiste e NÃO chega à janela (não fecha o modal)", () => {
    const { espiao, parar } = espiarEscNaJanela();
    const onSalvar = vi.fn();
    render(<TituloEditavel valor="Arte" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título/ }));
    const campo = screen.getByLabelText("Título da tarefa");
    fireEvent.change(campo, { target: { value: "Outra coisa" } });
    fireEvent.keyDown(campo, { key: "Escape" });
    parar();
    expect(espiao).not.toHaveBeenCalled();
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Editar o título: Arte/ })).toBeTruthy();
  });

  it("⚠️ título apagado volta ao original, sem salvar", () => {
    const onSalvar = vi.fn();
    render(<TituloEditavel valor="Arte" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título/ }));
    const campo = screen.getByLabelText("Título da tarefa");
    fireEvent.change(campo, { target: { value: "  " } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Editar o título: Arte/ })).toBeTruthy();
  });

  it("⚠️ erro reabre o campo com o que a pessoa escreveu, e a mensagem", async () => {
    const onSalvar = vi.fn().mockRejectedValue(new Error("Você não pode editar esta tarefa."));
    render(<TituloEditavel valor="Arte" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título/ }));
    fireEvent.change(screen.getByLabelText("Título da tarefa"), { target: { value: "Arte 2" } });
    fireEvent.keyDown(screen.getByLabelText("Título da tarefa"), { key: "Enter" });
    expect(await screen.findByText("Você não pode editar esta tarefa.")).toBeTruthy();
    expect((screen.getByLabelText("Título da tarefa") as HTMLTextAreaElement).value).toBe("Arte 2");
  });
});

// ------------------------------------------------------------------ descrição

/**
 * O editor da descrição (fatia E) e um jeito de ESCREVER nele.
 *
 * ⚠️ O CAMPO NÃO É MAIS `textarea`: é um editor (`contenteditable`), e o jsdom
 * não digita nele. Escrever é mandar o conteúdo pelo próprio editor, que avisa
 * o `onChange` como uma edição de verdade. O que se prova aqui é o GESTO em
 * volta (salvar, desistir, clicar fora); digitar `- ` virando lista está em
 * `lib/__tests__/editorDeDescricao.test.ts`.
 */
async function campoDaDescricao() {
  // ⚠️ PRAZO DE 5 s: o editor é baixado sob demanda (`React.lazy`) e montado
  // depois; com a suíte inteira rodando em paralelo, o 1 s padrão já falhou.
  const el = await screen.findByRole("textbox", { name: "Descrição" }, { timeout: 5000 });
  await waitFor(() => expect((el as unknown as { editor?: Editor }).editor).toBeTruthy(), {
    timeout: 5000,
  });
  const editor = (el as unknown as { editor: Editor }).editor;
  return {
    el,
    escrever: (markdown: string) =>
      act(() => {
        editor.commands.setContent(markdown, { contentType: "markdown" });
      }),
  };
}

describe("DescricaoEditavel", () => {
  it("sem descrição: o convite abre o campo, e não há \"Editar\"", async () => {
    render(<DescricaoEditavel valor="" onSalvar={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Editar descrição" })).toBeNull();
    fireEvent.click(screen.getByText("Adicionar uma descrição…"));
    expect((await campoDaDescricao()).el).toBeTruthy();
  });

  it("⭐ Enter NÃO salva (é quebra de linha); Ctrl+Enter salva", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<DescricaoEditavel valor="briefing" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar descrição" }));
    const campo = await campoDaDescricao();
    campo.escrever("briefing\nlinha 2");
    fireEvent.keyDown(campo.el, { key: "Enter" });
    expect(onSalvar).not.toHaveBeenCalled();
    fireEvent.keyDown(campo.el, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("briefing\nlinha 2"));
  });

  it("⭐ clicar fora salva UMA vez -- mesmo com o focusout do mesmo clique", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <DescricaoEditavel valor="briefing" onSalvar={onSalvar} />
        <input aria-label="lá fora" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar descrição" }));
    const campo = await campoDaDescricao();
    campo.escrever("briefing novo");
    const fora = screen.getByLabelText("lá fora");
    // ⚠️ NO MESMO `act`: no navegador os dois eventos chegam antes de o React
    // redesenhar. Em dois `fireEvent` separados o bloco já teria saído da tela
    // no segundo, e o teste passaria sem a guarda (medido: sabotagem sem a
    // guarda passava assim).
    act(() => {
      fora.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      campo.el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: fora }));
    });
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith("briefing novo"));
    expect(onSalvar).toHaveBeenCalledTimes(1);
  });

  it("clicar DENTRO (no Cancelar) não salva, e Cancelar desiste", async () => {
    const onSalvar = vi.fn();
    render(<DescricaoEditavel valor="briefing" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar descrição" }));
    (await campoDaDescricao()).escrever("mudou");
    const cancelar = screen.getByText("Cancelar");
    fireEvent.mouseDown(cancelar);
    fireEvent.click(cancelar);
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByText("briefing")).toBeTruthy();
  });

  it("⚠️ Esc desiste e não chega à janela", async () => {
    const { espiao, parar } = espiarEscNaJanela();
    const onSalvar = vi.fn();
    render(<DescricaoEditavel valor="briefing" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar descrição" }));
    const campo = await campoDaDescricao();
    campo.escrever("mudou");
    fireEvent.keyDown(campo.el, { key: "Escape" });
    parar();
    expect(espiao).not.toHaveBeenCalled();
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it("sem mudança, clicar fora só fecha", () => {
    const onSalvar = vi.fn();
    render(<DescricaoEditavel valor="briefing" onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar descrição" }));
    fireEvent.mouseDown(document.body);
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

// ------------------------------------------------------------------ links

const SALVOS = [
  { id: "l1", title: "Pasta principal", url: "https://drive.google.com/x" },
  { id: "l2", title: "Banco de imagens", url: "https://voleibrasil.media/" },
];

describe("LinksEditaveis", () => {
  it("⭐ renomear um link e clicar fora envia a lista inteira", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<LinksEditaveis links={SALVOS} falhou={false} onTentarDeNovo={vi.fn()} onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar links" }));
    fireEvent.change(screen.getByLabelText("Nome do link 1"), { target: { value: "Pasta do CBV" } });
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(onSalvar).toHaveBeenCalledWith([
        { title: "Pasta do CBV", url: "https://drive.google.com/x" },
        { title: "Banco de imagens", url: "https://voleibrasil.media/" },
      ]),
    );
    await waitFor(() => expect(screen.queryByLabelText("Nome do link 1")).toBeNull());
  });

  it("⭐ sem mudança, Salvar não envia nada", () => {
    const onSalvar = vi.fn();
    render(<LinksEditaveis links={SALVOS} falhou={false} onTentarDeNovo={vi.fn()} onSalvar={onSalvar} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar links" }));
    fireEvent.click(screen.getByText("Salvar"));
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Nome do link 1")).toBeNull();
  });

  it("⚠️ link com erro NÃO salva ao clicar fora -- o editor fica, com o erro", () => {
    const onSalvar = vi.fn();
    render(<LinksEditaveis links={[]} falhou={false} onTentarDeNovo={vi.fn()} onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar link"));
    fireEvent.change(screen.getByLabelText("Nome do link 1"), { target: { value: "Pasta" } });
    fireEvent.mouseDown(document.body);
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome do link 1")).toBeTruthy();
    expect(screen.getByText("Falta o endereço.")).toBeTruthy();
  });

  it("sem links, \"Adicionar link\" abre com uma linha vazia -- e desistir não envia", () => {
    const onSalvar = vi.fn();
    render(<LinksEditaveis links={[]} falhou={false} onTentarDeNovo={vi.fn()} onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar link"));
    expect(document.activeElement).toBe(screen.getByLabelText("Nome do link 1"));
    fireEvent.mouseDown(document.body);
    expect(onSalvar).not.toHaveBeenCalled();
    expect(screen.getByText("Adicionar link")).toBeTruthy();
  });

  it("⚠️ lista ainda não carregada: nada para editar -- nem \"Adicionar link\"", () => {
    const { container } = render(
      <LinksEditaveis links={null} falhou={false} onTentarDeNovo={vi.fn()} onSalvar={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("⚠️⚠️ a busca falhou: aparece o erro com \"Tentar de novo\", e NÃO há como editar", () => {
    // Revisão de 16/09: com a falha virando `[]`, adicionar um link mandava só
    // ele e apagava os que existiam.
    const onTentarDeNovo = vi.fn();
    render(<LinksEditaveis links={null} falhou onTentarDeNovo={onTentarDeNovo} onSalvar={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("Não consegui carregar os links");
    expect(screen.queryByText("Adicionar link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar links" })).toBeNull();
    fireEvent.click(screen.getByText("Tentar de novo"));
    expect(onTentarDeNovo).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ o detalhe

const COLUNAS: Coluna[] = [
  {
    id: "col-backlog",
    name: "Backlog",
    color: "var(--status-backlog-dot)",
    position: 0,
    semantic: "OPEN",
    notify_deadline: true,
    is_default_target: true,
    is_status_bridge: false,
  },
];

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Arte",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    start_date: null,
    due_date: null,
    due_time: null,
    project_id: null,
    parent_task_id: null,
    team_id: "team-mkt",
    path: "t1",
    depth: 0,
    position: 0,
    completed_at: null,
    is_archived: false,
    created_by: "u1",
    created_at: "2026-09-16T12:00:00Z",
    updated_at: "2026-09-16T12:00:00Z",
    assignee_ids: [],
    board_id: "board-geral",
    column_id: "col-backlog",
    can_delete: true,
    ...over,
  };
}

describe("TaskDetail -- edição no lugar (Spec 052, fatia D)", () => {
  beforeEach(() => {
    vi.mocked(api.colunasDoQuadro).mockResolvedValue(COLUNAS);
    vi.mocked(api.listarFilhas).mockResolvedValue([]);
    vi.mocked(api.listComments).mockResolvedValue({ items: [], total: 0, page: 1, size: 100 });
    vi.mocked(api.currentUser).mockResolvedValue({
      id: "u1",
      name: "Camila",
      email: "c@t.dev",
      must_change_password: false,
      roles: ["ADMIN"],
      permissions: ["task.create", "task.update", "task.delete"],
      org_role: null,
      teams: [],
    } as unknown as Awaited<ReturnType<typeof api.currentUser>>);
    vi.mocked(api.listMembersDoTime).mockResolvedValue([]);
    vi.mocked(api.listProjects).mockResolvedValue({ items: [], total: 0, page: 1, size: 100 });
    vi.mocked(api.getRootTeamId).mockResolvedValue("team-mkt");
    vi.mocked(api.getTaskLinks).mockResolvedValue([]);
  });

  function detalhe(t: Task, onSubtaskUpsert = vi.fn()) {
    return (
      <TaskDetail
        task={t}
        members={new Map()}
        projects={new Map()}
        temVoltar={false}
        onVoltar={vi.fn()}
        onClose={vi.fn()}
        onDuplicar={vi.fn()}
        onAssigneesChange={vi.fn()}
        onAbrirSubtarefa={vi.fn()}
        onSubtaskUpsert={onSubtaskUpsert}
        onTaskMoved={vi.fn()}
        onExcluir={vi.fn()}
        mostrarArquivadas={false}
        membrosInativos={new Set()}
      />
    );
  }

  function montar(onSubtaskUpsert = vi.fn()) {
    return render(detalhe(task(), onSubtaskUpsert));
  }

  it("⭐ não há mais o \"Editar\" do rodapé", async () => {
    montar();
    expect(await screen.findByText("Copiar link")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("⭐ título salvo fica na tela MESMO SE O PAI NÃO APLICA a resposta", async () => {
    // É o caso de `/tarefa/[id]`, cujo `onSubtaskUpsert` só mexe nas filhas.
    vi.mocked(api.updateTask).mockResolvedValue(task({ title: "Arte do CBV" }));
    const onSubtaskUpsert = vi.fn();
    montar(onSubtaskUpsert);
    fireEvent.click(screen.getByRole("button", { name: /Editar o título: Arte/ }));
    const campo = screen.getByLabelText("Título da tarefa");
    fireEvent.change(campo, { target: { value: "Arte do CBV" } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("t1", { title: "Arte do CBV" }));
    await waitFor(() => expect(onSubtaskUpsert).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Editar o título: Arte do CBV/ })).toBeTruthy();
  });

  it("descrição salva manda SÓ a descrição", async () => {
    vi.mocked(api.updateTask).mockResolvedValue(task({ description: "briefing" }));
    montar();
    fireEvent.click(await screen.findByText("Adicionar uma descrição…"));
    (await campoDaDescricao()).escrever("briefing");
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith("t1", { description: "briefing" }));
    expect(await screen.findByText("briefing")).toBeTruthy();
  });

  it("⚠️⚠️ salvar os links de A e ir para B antes da resposta: B NÃO recebe os links de A", async () => {
    // Revisão de 16/09: o clique fora que salva os links pode ser o mesmo que
    // abre outra tarefa (uma subtarefa da checklist). A resposta de A chegava
    // depois e pintava os links de A no detalhe de B.
    const LINKS_A = [{ id: "la", title: "Pasta de A", url: "https://a.com/pasta" }];
    vi.mocked(api.getTaskLinks).mockImplementation(async (id: string) => (id === "t1" ? LINKS_A : []));
    let responder: (v: typeof LINKS_A) => void = () => {};
    vi.mocked(api.putTaskLinks).mockImplementation(
      () => new Promise((ok) => { responder = ok; }),
    );

    const { rerender } = render(detalhe(task()));
    fireEvent.click(await screen.findByRole("button", { name: "Editar links" }));
    fireEvent.change(screen.getByLabelText("Nome do link 1"), { target: { value: "Pasta de A (nova)" } });
    fireEvent.click(screen.getByText("Salvar"));
    await waitFor(() => expect(api.putTaskLinks).toHaveBeenCalled());

    // Navega para B com o PUT de A ainda em voo.
    rerender(detalhe(task({ id: "t2", path: "t2", title: "Tarefa B" })));
    expect(await screen.findByText("Adicionar link")).toBeTruthy();

    await act(async () => {
      responder([{ id: "la", title: "Pasta de A (nova)", url: "https://a.com/pasta" }]);
    });
    expect(screen.queryByText("Pasta de A (nova)")).toBeNull();
    expect(screen.getByText("Adicionar link")).toBeTruthy();
  });

  it("⚠️ a busca dos links da tarefa falhou: aparece o erro, e tentar de novo busca", async () => {
    vi.mocked(api.getTaskLinks).mockRejectedValueOnce(new Error("rede")).mockResolvedValue([]);
    montar();
    fireEvent.click(await screen.findByText("Tentar de novo"));
    expect(await screen.findByText("Adicionar link")).toBeTruthy();
    expect(api.getTaskLinks).toHaveBeenCalledTimes(2);
  });
});
