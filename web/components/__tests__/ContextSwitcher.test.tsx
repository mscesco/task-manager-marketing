// Desenho do seletor de contexto (a regra é testada em `lib/__tests__/contextSwitcher.test.ts`).
// Não cobre a saída animada: no jsdom o `exit` do `AnimatePresence` não termina.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ContextSwitcher from "@/components/ContextSwitcher";
import type { CurrentUser, Team } from "@/lib/api";

afterEach(cleanup);

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const TI = "t-ti";

function time(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  time(TI, "TI", null),
  time(MKT, "Marketing", null),
  time(SEO, "SEO", MKT),
  time(JR, "SEO Junior", SEO),
];

function pessoa(vinculos: string[]): CurrentUser {
  return {
    id: "u-1",
    name: "Fulano",
    email: "fulano@t.dev",
    must_change_password: false,
    roles: [],
    permissions: [],
    teams: vinculos.map((team_id) => ({ team_id, role: "OPERATOR" as const })),
  } as unknown as CurrentUser;
}

function desenhar(opts: {
  vinculos: string[];
  canManageOrg?: boolean;
  pathname?: string;
  teams?: Team[];
  orgName?: string;
  search?: string;
}) {
  render(
    <ContextSwitcher
      teams={opts.teams ?? TIMES}
      me={pessoa(opts.vinculos)}
      pathname={opts.pathname ?? "/minhas-tarefas"}
      search={opts.search ?? ""}
      canManageOrg={opts.canManageOrg ?? false}
      expanded
      orgName={opts.orgName ?? "UniFECAF"}
    />,
  );
}

describe("ContextSwitcher", () => {
  it("⭐⭐ um time e sem poder na organização: RÓTULO, sem botão", () => {
    desenhar({ vinculos: [SEO] });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Time atual: Marketing")).toBeTruthy();
  });

  it("dois times: vira botão que abre o menu", () => {
    desenhar({ vinculos: [SEO, TI] });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("⭐⭐ a lista NÃO traz subtime — só time raiz", () => {
    desenhar({ vinculos: [], canManageOrg: true });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    const itens = screen
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("href") ?? "");
    // Afirma o id, não a rota: o destino é de `switcherHref`.
    const temTime = (id: string) => itens.some((h) => h.includes(id));
    expect(temTime(MKT)).toBe(true);
    expect(temTime(TI)).toBe(true);
    expect(temTime(SEO)).toBe(false);
    expect(temTime(JR)).toBe(false);
  });

  it("⭐⭐ 'Gerenciar a organização' respeita o gate", () => {
    // É a única porta para a tela de organização.
    desenhar({ vinculos: [], canManageOrg: true });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    expect(
      screen.getByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeTruthy();

    cleanup();
    // Sem o poder, e com dois times para que ainda haja seletor.
    desenhar({ vinculos: [SEO, TI] });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    expect(
      screen.queryByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeNull();
    // E os times continuam lá: quem não administra a organização ainda navega.
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("⭐ quem administra a organização vê o seletor mesmo com um time só", () => {
    desenhar({
      vinculos: [SEO],
      canManageOrg: true,
      teams: [TIMES[1], TIMES[2]],
    });
    expect(screen.getByRole("button", { name: /trocar de time/i })).toBeTruthy();
  });

  it("marca o time em que a pessoa está", () => {
    desenhar({ vinculos: [SEO, TI], pathname: `/times/${MKT}` });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    const atual = screen.getAllByRole("menuitem", { current: true });
    expect(atual.map((a) => a.textContent)).toEqual(["Marketing"]);
  });

  it("⭐⭐ o botão MOSTRA onde a pessoa está, e nunca 'Trocar de time'", () => {
    // O texto visível é o contexto; a ação fica no `aria-label` e no `title`.
    desenhar({ vinculos: [SEO, TI], pathname: `/times/${SEO}` });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    // O subtime resolve para o time raiz.
    expect(gatilho.textContent).toContain("Marketing");
    expect(gatilho.textContent).not.toContain("Trocar de time");
  });

  it("⭐ fora de um time, o botão mostra o nome da ORGANIZAÇÃO", () => {
    desenhar({
      vinculos: [SEO, TI],
      pathname: "/minhas-tarefas",
      orgName: "UniFECAF",
    });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    expect(gatilho.textContent).toContain("UniFECAF");
  });

  it("sem time e sem poder na organização, não desenha nada", () => {
    const { container } = render(
      <ContextSwitcher
        teams={TIMES}
        me={pessoa([])}
        pathname="/minhas-tarefas"
        search=""
        canManageOrg={false}
        expanded
        orgName="UniFECAF"
      />,
    );
    expect(container.textContent).toBe("");
  });
});

