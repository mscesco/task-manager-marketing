/**
 * A aba de webhooks: só oferece time que a pessoa alcança, cria com o que foi
 * escolhido, mostra o segredo uma vez, e pausar/histórico chamam a API certa.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WebhooksDoDev from "@/components/WebhooksDoDev";
import type { Quadro, Team, Webhook } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listWebhooks: vi.fn(),
    listTeamsAll: vi.fn(),
    listBoards: vi.fn(),
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    listWebhookDeliveries: vi.fn(),
  };
});

const api = await import("@/lib/api");

const time = (id: string, name: string, parent: string | null = null): Team =>
  ({ id, name, parent_team_id: parent, workspace_id: "ws", slug: id }) as Team;
const quadro = (id: string, name: string, team_id: string): Quadro =>
  ({ id, name, team_id, is_default: false, colunas: [] }) as Quadro;

const HOOK: Webhook = {
  id: "h1",
  url: "https://n8n.exemplo/webhook/x",
  team_id: "mkt",
  board_id: null,
  events: ["task.created"],
  is_active: true,
  consecutive_failures: 0,
  created_at: "2026-11-19T15:00:00Z",
};

function montar(hooks: Webhook[] = []) {
  vi.mocked(api.listWebhooks).mockResolvedValue(hooks);
  vi.mocked(api.listTeamsAll).mockResolvedValue([
    time("mkt", "Marketing"),
    time("seo", "SEO", "mkt"),
    time("com", "Comercial"),
  ]);
  vi.mocked(api.listBoards).mockResolvedValue([
    quadro("b1", "Quadro geral", "mkt"),
    quadro("b2", "Pautas", "seo"),
  ]);
  render(<WebhooksDoDev />);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WebhooksDoDev", () => {
  it("cria com time, quadro e eventos e mostra o segredo uma vez", async () => {
    vi.mocked(api.createWebhook).mockResolvedValue({ ...HOOK, id: "h2", secret: "s3gr3do" });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Novo webhook" }));

    const times = within(screen.getByLabelText("Time")).getAllByRole("option").map((o) => o.textContent);
    // Comercial não tem quadro ao alcance: não aparece.
    expect(times).toEqual(["Marketing", "↳ SEO"]);

    fireEvent.change(screen.getByLabelText("URL de destino"), {
      target: { value: "https://n8n.exemplo/webhook/x" },
    });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "seo" } });
    fireEvent.change(screen.getByLabelText(/Quadro/), { target: { value: "b2" } });
    fireEvent.click(screen.getByLabelText("Solicitação recebida"));
    fireEvent.click(screen.getByRole("button", { name: "Criar webhook" }));

    await waitFor(() =>
      expect(api.createWebhook).toHaveBeenCalledWith({
        url: "https://n8n.exemplo/webhook/x",
        team_id: "seo",
        board_id: "b2",
        events: ["task.created", "solicitation.created"],
      }),
    );
    expect(await screen.findByDisplayValue("s3gr3do")).toBeTruthy();
  });

  it("recusa URL sem https antes de mandar", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Novo webhook" }));
    fireEvent.change(screen.getByLabelText("URL de destino"), { target: { value: "http://x.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar webhook" }));
    expect((await screen.findByRole("alert")).textContent).toContain("https://");
    expect(api.createWebhook).not.toHaveBeenCalled();
  });

  it("desligado por falhas mostra o motivo e religar chama a API", async () => {
    vi.mocked(api.updateWebhook).mockResolvedValue({ ...HOOK, is_active: true });
    montar([{ ...HOOK, is_active: false, consecutive_failures: 20 }]);
    expect(await screen.findByText("Desligado por falhas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Religar" }));
    await waitFor(() => expect(api.updateWebhook).toHaveBeenCalledWith("h1", { is_active: true }));
    expect(await screen.findByText("Ativo")).toBeTruthy();
  });

  it("histórico lista as entregas com o erro", async () => {
    vi.mocked(api.listWebhookDeliveries).mockResolvedValue([
      {
        id: "d1",
        event: "task.created",
        status_code: null,
        error: "Endereço de rede interna recusado.",
        duration_ms: 3,
        delivered_at: "2026-11-19T15:00:00Z",
      },
    ]);
    montar([HOOK]);
    fireEvent.click(await screen.findByRole("button", { name: "Histórico" }));
    expect(await screen.findByText("Endereço de rede interna recusado.")).toBeTruthy();
  });
});
