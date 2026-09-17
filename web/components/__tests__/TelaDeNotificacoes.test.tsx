// Spec 053, fatia F -- a tela `/notificacoes` e o "Ver todas" do sino.
//
// O que se prende aqui e a MONTAGEM; a regra (URL, tipos, agrupamento, rotulo)
// esta em `lib/telaDeNotificacoes.ts`:
//   - o filtro da URL vai para a API, e o "marcar estas" manda o MESMO filtro;
//   - sem filtro, o botao marca todas (chamada sem filtro);
//   - aviso de tarefa inacessivel: sem link, com o selo;
//   - "So desta tarefa" refaz a busca pela tarefa e grava na URL;
//   - o sino tem "Ver todas" e nao navega em aviso inacessivel.
//
// SABOTAGEM (medida): em `TelaDeNotificacoes.marcarEstas`, mandar `{}` sempre.
// Deve cair "⚠️ marcar estas manda o MESMO filtro da lista".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import NotificationBell from "@/components/NotificationBell";
import TelaDeNotificacoes from "@/components/TelaDeNotificacoes";
import type { AppNotification } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notificacoes",
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listNotifications: vi.fn(),
    listNotificationTargets: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
    getUnreadCount: vi.fn(),
  };
});

const api = await import("@/lib/api");

function aviso(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    type: "TASK_COMMENTED",
    actor_id: "u-ana",
    task_id: "t1",
    comment_id: null,
    payload: { actor_name: "Ana", task_title: "Banner" },
    read_at: null,
    created_at: "2026-09-17T12:00:00Z",
    updated_at: "2026-09-17T12:00:00Z",
    task_access: "ok",
    ...over,
  };
}

function pagina(items: AppNotification[]) {
  return { items, total: items.length, page: 1, size: 20 };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/notificacoes");
  vi.mocked(api.listNotifications).mockResolvedValue(pagina([aviso()]));
  vi.mocked(api.markAllNotificationsRead).mockResolvedValue(1);
  vi.mocked(api.markNotificationRead).mockResolvedValue(undefined);
  vi.mocked(api.getUnreadCount).mockResolvedValue(1);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("tela de notificações", () => {
  it("le o filtro da URL e o manda para a API", async () => {
    window.history.replaceState(null, "", "/notificacoes?aba=todas&tipo=prazos&tarefa=t9&nome=Banner");
    render(<TelaDeNotificacoes />);

    await waitFor(() => expect(api.listNotifications).toHaveBeenCalled());
    expect(vi.mocked(api.listNotifications).mock.calls[0][0]).toEqual({
      types: ["TASK_DUE_CHANGED", "TASK_DUE_SOON", "TASK_OVERDUE"],
      task_id: "t9",
      project_id: null,
      unread_only: false,
      page: 1,
      size: 20,
    });
  });

  it("⚠️ marcar estas manda o MESMO filtro da lista", async () => {
    window.history.replaceState(null, "", "/notificacoes?tipo=mencoes");
    render(<TelaDeNotificacoes />);

    fireEvent.click(await screen.findByRole("button", { name: "Marcar esta 1 como lida" }));

    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalled());
    expect(vi.mocked(api.markAllNotificationsRead).mock.calls[0][0]).toEqual({
      types: ["TASK_MENTIONED"],
      task_id: null,
      project_id: null,
    });
  });

  it("sem filtro, o botao marca todas", async () => {
    render(<TelaDeNotificacoes />);
    fireEvent.click(await screen.findByRole("button", { name: "Marcar todas como lidas" }));
    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalledWith({}));
  });

  it("aviso acessivel e link; inacessivel e apagado, sem link e com o selo", async () => {
    vi.mocked(api.listNotifications).mockResolvedValue(
      pagina([
        aviso({ id: "ok" }),
        aviso({
          id: "sumiu",
          task_id: "t2",
          task_access: "gone",
          payload: { actor_name: "Bia" },
        }),
      ]),
    );
    render(<TelaDeNotificacoes />);

    const link = (await screen.findByText('Ana comentou em "Banner"')).closest("a");
    expect(link?.getAttribute("href")).toBe("/tarefa/t1");

    const sumido = screen.getByText("Bia comentou em uma tarefa");
    expect(sumido.closest("a")).toBeNull();
    expect(screen.getByText("tarefa excluída ou sem acesso")).toBeTruthy();
  });

  it("'Só desta tarefa' refaz a busca pela tarefa e grava na URL", async () => {
    render(<TelaDeNotificacoes />);
    fireEvent.click(await screen.findByRole("button", { name: "Só desta tarefa" }));

    await waitFor(() =>
      expect(
        vi.mocked(api.listNotifications).mock.calls.some((c) => c[0]?.task_id === "t1"),
      ).toBe(true),
    );
    expect(window.location.search).toContain("tarefa=t1");
    expect(await screen.findByText("Banner", { selector: "strong" })).toBeTruthy();
  });

  it("lista vazia com filtro oferece limpar", async () => {
    vi.mocked(api.listNotifications).mockResolvedValue(pagina([]));
    window.history.replaceState(null, "", "/notificacoes?tipo=reacoes");
    render(<TelaDeNotificacoes />);

    expect(await screen.findByText("Nenhuma notificação com esses filtros")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Limpar filtros" }).length).toBeGreaterThan(0);
  });
});

describe("sino", () => {
  it("tem 'Ver todas' e nao navega em aviso inacessivel", async () => {
    vi.mocked(api.listNotifications).mockResolvedValue(
      pagina([aviso({ id: "sumiu", task_access: "gone", payload: { actor_name: "Bia" } })]),
    );
    render(<NotificationBell />);

    fireEvent.click(screen.getByLabelText("Notificacoes"));
    expect((await screen.findByText("Ver todas")).closest("a")?.getAttribute("href")).toBe(
      "/notificacoes",
    );

    fireEvent.click(await screen.findByText("Bia comentou em uma tarefa"));
    expect(api.markNotificationRead).toHaveBeenCalledWith("sumiu");
    expect(push).not.toHaveBeenCalled();
  });
});
