// O cartão "Notificações" do Meu perfil (montagem). A regra está em
// `lib/notificationPreferences.ts`; aqui se prende o desenho: um interruptor por
// célula com o nome da linha e da coluna, clicar manda `{type_group, role,
// enabled}` e vira na hora, falha VOLTA ATRÁS e avisa, travada fica ligada e
// desabilitada.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import NotificationPreferences from "@/components/NotificationPreferences";
import { ApiError, type NotificationToggle } from "@/lib/api";
import { ROWS } from "@/lib/notificationPreferences";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listNotificationPreferences: vi.fn(),
    setNotificationPreference: vi.fn(),
  };
});

const api = await import("@/lib/api");

/** Tudo ligado, como o servidor devolve para quem nunca mexeu. */
function tudoLigado(): NotificationToggle[] {
  return ROWS.flatMap((r) =>
    r.roles.map((role) => ({
      type_group: r.group,
      role,
      enabled: true,
      locked: r.locked,
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listNotificationPreferences).mockResolvedValue(tudoLigado());
  vi.mocked(api.setNotificationPreference).mockImplementation(async (p) =>
    tudoLigado().map((t) =>
      t.type_group === p.type_group && t.role === p.role ? { ...t, enabled: p.enabled } : t,
    ),
  );
});

// Explícito: sem isto uma tela fica montada e a
// proxima `getByRole` acha dois interruptores com o mesmo nome.
afterEach(() => cleanup());

describe("a grade", () => {
  it("nasce com um interruptor por célula, todos ligados", async () => {
    render(<NotificationPreferences />);
    const interruptores = await screen.findAllByRole("switch");
    expect(interruptores.length).toBe(tudoLigado().length);
    expect(interruptores.every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    expect(screen.getByText("Você recebe todos os avisos.")).toBeTruthy();
  });

  it("cada célula se chama pela linha e pela coluna, e prazo não tem seguidor", async () => {
    render(<NotificationPreferences />);
    const tabela = await screen.findByRole("table");
    for (const rotulo of ["Seguidor", "Responsável", "Criador"]) {
      expect(within(tabela).getByRole("columnheader", { name: rotulo })).toBeTruthy();
    }
    expect(screen.getByRole("switch", { name: "Comentário novo, como seguidor" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Prazo chegando, como responsável" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Prazo chegando, como seguidor" })).toBeNull();
    // A coluna vazia diz "não se aplica", e não finge um interruptor.
    expect(screen.getAllByLabelText("não se aplica").length).toBe(2);
  });

  it("travada fica ligada, desabilitada e com a explicacao", async () => {
    render(<NotificationPreferences />);
    const mencao = await screen.findByRole("switch", { name: "Menção" });
    expect(mencao.getAttribute("aria-checked")).toBe("true");
    expect((mencao as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Alguém chamou você com @ — sempre avisa.")).toBeTruthy();
  });
});

describe("gravar", () => {
  it("clicar desliga na hora e manda o toggle", async () => {
    render(<NotificationPreferences />);
    const celula = await screen.findByRole("switch", {
      name: "Comentário novo, como seguidor",
    });
    fireEvent.click(celula);

    // otimista: virou antes da resposta
    expect(celula.getAttribute("aria-checked")).toBe("false");
    expect(api.setNotificationPreference).toHaveBeenCalledWith({
      type_group: "comment",
      role: "watcher",
      enabled: false,
    });
    await waitFor(() => expect(screen.getByText("1 aviso desligado.")).toBeTruthy());
  });

  it("religar manda enabled true", async () => {
    vi.mocked(api.listNotificationPreferences).mockResolvedValue(
      tudoLigado().map((t) =>
        t.type_group === "reaction" ? { ...t, enabled: false } : t,
      ),
    );
    render(<NotificationPreferences />);
    const celula = await screen.findByRole("switch", { name: "Reação ao seu comentário" });
    expect(celula.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(celula);
    expect(api.setNotificationPreference).toHaveBeenCalledWith({
      type_group: "reaction",
      role: "none",
      enabled: true,
    });
  });

  it("⚠️ falha volta atras e avisa", async () => {
    vi.mocked(api.setNotificationPreference).mockRejectedValue(
      new ApiError(422, "Este aviso nao pode ser desligado.", "validation_error"),
    );
    render(<NotificationPreferences />);
    const celula = await screen.findByRole("switch", {
      name: "Comentário novo, como seguidor",
    });
    fireEvent.click(celula);

    await waitFor(() => expect(celula.getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByText("Você recebe todos os avisos.")).toBeTruthy();
  });

  it("a resposta do servidor manda, inclusive nos grupos de dois tipos", async () => {
    // "Arquivar e desarquivar" governa dois tipos: o servidor devolve a lista
    // inteira, e a tela mostra o que ficou gravado.
    vi.mocked(api.setNotificationPreference).mockResolvedValue(
      tudoLigado().map((t) =>
        t.type_group === "archive" ? { ...t, enabled: false } : t,
      ),
    );
    render(<NotificationPreferences />);
    fireEvent.click(
      await screen.findByRole("switch", { name: "Arquivar e desarquivar, como criador" }),
    );

    await waitFor(() => expect(screen.getByText("3 avisos desligados.")).toBeTruthy());
    for (const papel of ["seguidor", "responsável", "criador"]) {
      const c = screen.getByRole("switch", {
        name: `Arquivar e desarquivar, como ${papel}`,
      });
      expect(c.getAttribute("aria-checked")).toBe("false");
    }
  });
});

describe("carregar", () => {
  it("erro mostra recado e nenhuma grade", async () => {
    vi.mocked(api.listNotificationPreferences).mockRejectedValue(new Error("caiu"));
    render(<NotificationPreferences />);
    expect(
      await screen.findByText("Não consegui carregar suas preferências de notificação."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("switch").length).toBe(0);
  });
});
