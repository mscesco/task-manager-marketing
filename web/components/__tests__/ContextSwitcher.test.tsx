// Spec 047, revisão de 09/09 -- o seletor de contexto no rodapé da barra.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: o seletor virou a ÚNICA porta para a tela de
// organização, depois que a entrada saiu do menu. Um erro aqui não dá tela
// vermelha -- ele some com um caminho, e quem não sabia que ele existia não
// vai reclamar da falta.
//
// ⚠️ A REGRA (rótulo x seletor, quais raízes) mora em `lib/contextSwitcher.ts`
// e é testada lá, sem React. Aqui prende-se só o DESENHO: que o rótulo não é
// clicável, que a lista traz o que deve, e que o gate de organização vale.
//
// ⚠️ O QUE ELE **NÃO** COBRE: a animação, nem a saída do painel do DOM. Com
// `AnimatePresence` o nó fica montado enquanto o `exit` roda, e no jsdom esse
// `exit` não termina — não há layout nem quadro.
//
// SABOTAGENS medidas -- ver o fim do arquivo.

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
}) {
  render(
    <ContextSwitcher
      teams={opts.teams ?? TIMES}
      me={pessoa(opts.vinculos)}
      pathname={opts.pathname ?? "/minhas-tarefas"}
      canManageOrg={opts.canManageOrg ?? false}
      expanded
      orgName={opts.orgName ?? "UniFECAF"}
    />,
  );
}

describe("ContextSwitcher", () => {
  it("⭐⭐ uma área e sem poder na organização: RÓTULO, sem botão", () => {
    // ⚠️ A regra de 19/08, repetida em 09/09. Um item clicável que não leva a
    // lugar nenhum é pior que um rótulo -- e quem só tem uma área não tem
    // para onde ir.
    desenhar({ vinculos: [SEO] });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Time atual: Marketing")).toBeTruthy();
  });

  it("duas áreas: vira botão que abre o menu", () => {
    desenhar({ vinculos: [SEO, TI] });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("⭐⭐ a lista NÃO traz subtime — só time raiz", () => {
    // ⚠️ Pedido literal da Camila: *"subtimes não são para aparecer ali, só
    // times raiz e a opção de gerenciar a organização"*. O seletor responde
    // "em qual ÁREA estou"; subtime é navegação DENTRO da área.
    desenhar({ vinculos: [], canManageOrg: true });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    const itens = screen
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("href"));
    expect(itens).toContain(`/times/${MKT}`);
    expect(itens).toContain(`/times/${TI}`);
    expect(itens).not.toContain(`/times/${SEO}`);
    expect(itens).not.toContain(`/times/${JR}`);
  });

  it("⭐⭐ 'Gerenciar a organização' respeita o gate", () => {
    // ⚠️⚠️ Ao tirar a entrada do menu, o gate `area.create` veio junto — e um
    // gate perdido numa mudança de NAVEGAÇÃO é invisível: no sentido frouxo só
    // o 403 acusa; no apertado, a porta simplesmente some.
    desenhar({ vinculos: [], canManageOrg: true });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    expect(
      screen.getByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeTruthy();

    cleanup();
    // Sem o poder, e com duas áreas para que ainda haja seletor.
    desenhar({ vinculos: [SEO, TI] });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    expect(
      screen.queryByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeNull();
    // E as áreas continuam lá: quem não administra a organização ainda navega.
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("⭐ quem administra a organização vê o seletor mesmo com uma área só", () => {
    // ⚠️ Porque "Gerenciar a organização" mora dentro dele, e é a ÚNICA porta
    // para aquela tela. Virar rótulo aqui a esconderia de quem precisa dela.
    desenhar({
      vinculos: [SEO],
      canManageOrg: true,
      teams: [TIMES[1], TIMES[2]],
    });
    expect(screen.getByRole("button", { name: /trocar de time/i })).toBeTruthy();
  });

  it("marca a área em que a pessoa está", () => {
    desenhar({ vinculos: [SEO, TI], pathname: `/times/${MKT}` });
    fireEvent.click(screen.getByRole("button", { name: /trocar de time/i }));
    const marketing = screen.getByRole("menuitem", { name: /Marketing/ });
    expect(marketing.className).toContain("text-accent");
  });

  it("⭐⭐ o botão MOSTRA onde a pessoa está, e nunca 'Trocar de área'", () => {
    // ⚠️⚠️ Reportado em 10/09: *"não é para ser mostrado 'Trocar de área', mas
    // sim onde ele está no momento"*. O texto visível é o contexto; a AÇÃO
    // sobrou só no `aria-label` e no `title`, onde ela é resposta a "o que este
    // botão faz" e não a "onde estou".
    desenhar({ vinculos: [SEO, TI], pathname: `/times/${SEO}` });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    // O subtime resolve para a ÁREA.
    expect(gatilho.textContent).toContain("Marketing");
    expect(gatilho.textContent).not.toContain("Trocar de time");
  });

  it("⭐ fora de uma área, o botão mostra o nome da ORGANIZAÇÃO", () => {
    desenhar({
      vinculos: [SEO, TI],
      pathname: "/minhas-tarefas",
      orgName: "UniFECAF",
    });
    const gatilho = screen.getByRole("button", { name: /trocar de time/i });
    expect(gatilho.textContent).toContain("UniFECAF");
  });

  it("sem área e sem poder na organização, não desenha nada", () => {
    const { container } = render(
      <ContextSwitcher
        teams={TIMES}
        me={pessoa([])}
        pathname="/minhas-tarefas"
        canManageOrg={false}
        expanded
        orgName="UniFECAF"
      />,
    );
    expect(container.textContent).toBe("");
  });
});

// SABOTAGENS medidas:
//   A. Ignorar `canManageOrg` e mostrar sempre "Gerenciar a organização".
//      **Cai 1** -- o teste ⭐⭐ do gate.
//   B. Listar todos os times em vez de só as raízes. **Cai 2**.
//   C. Transformar o rótulo em botão. **Cai 1**: o teste ⭐⭐ do rótulo.
