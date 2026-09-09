// Spec 047, revisão de 09/09 -- o seletor de contexto da barra lateral.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: o seletor virou a ÚNICA porta para a tela
// de organização e para a árvore de times, depois que as duas entradas saíram
// do menu. Um erro aqui não dá tela vermelha -- ele some com um caminho, e
// quem não sabia que ele existia não vai reclamar da falta.
//
// O que ELE prende:
//   - a lista mostra ÁREAS com os subtimes delas, e para nesses dois níveis;
//   - "Gerenciar a organização" respeita `area.create`, o MESMO gate que a
//     entrada de menu tinha (cortar do menu não pode abrir porta nova);
//   - o rótulo do gatilho diz onde a pessoa está, e não inventa um time
//     quando ela não está em nenhum;
//   - `aria-expanded` acompanha abrir e fechar.
//
// ⚠️ O QUE ELE **NÃO** COBRE: a animação, nem a saída do painel do DOM. Com
// `AnimatePresence` o nó fica montado enquanto o `exit` roda, e no jsdom esse
// `exit` não termina — não há layout nem quadro. Afirmar "sumiu" aqui seria
// afirmar sobre o motion.
//
// SABOTAGENS medidas -- ver o fim do arquivo.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ContextSwitcher, {
  switcherTrees,
  contextLabel,
} from "@/components/ContextSwitcher";
import type { Team } from "@/lib/api";

afterEach(cleanup);

const MKT = "t-mkt";
const SEO = "t-seo";
const JR = "t-jr";
const TI = "t-ti";

function team(id: string, nome: string, parent: string | null): Team {
  return { id, workspace_id: "ws", parent_team_id: parent, name: nome, slug: id };
}

const TIMES: Team[] = [
  team(TI, "TI", null),
  team(MKT, "Marketing", null),
  team(SEO, "SEO", MKT),
  team(JR, "SEO Junior", SEO),
];

describe("switcherTrees", () => {
  it("agrupa por área, ordenado por nome", () => {
    const arvores = switcherTrees(TIMES);
    expect(arvores.map((a) => a.area.name)).toEqual(["Marketing", "TI"]);
  });

  it("⭐ para em DOIS níveis — o neto não entra no menu", () => {
    // ⚠️ Um menu com indentação de neto vira mapa, e mapa não se lê com o
    // mouse parado. O neto se alcança entrando no pai — a mesma escolha da
    // visão "Subtimes" da tela de time.
    const marketing = switcherTrees(TIMES)[0];
    expect(marketing.subteams.map((t) => t.name)).toEqual(["SEO"]);
  });

  it("área sem subtime não some da lista", () => {
    const ti = switcherTrees(TIMES)[1];
    expect(ti.subteams).toEqual([]);
  });
});

describe("contextLabel", () => {
  it("numa tela de time, diz o nome do time", () => {
    expect(contextLabel(`/times/${SEO}`, TIMES)).toBe("SEO");
  });

  it("na organização, diz Organização", () => {
    expect(contextLabel("/organizacao", TIMES)).toBe("Organização");
  });

  it("⭐ fora dessas telas NÃO inventa um time", () => {
    // ⚠️ Escolher um nome qualquer (o primeiro time, o time da pessoa)
    // sugeriria um contexto ativo que a tela não tem — e o seletor passaria a
    // mentir sobre onde a pessoa está.
    expect(contextLabel("/minhas-tarefas", TIMES)).toBe(
      "Times e organização",
    );
  });

  it("time desconhecido cai no rótulo neutro, e não em vazio", () => {
    expect(contextLabel("/times/sumiu", TIMES)).toBe("Times e organização");
  });
});

describe("ContextSwitcher", () => {
  function abrir(canManageOrg = true, pathname = "/minhas-tarefas") {
    render(
      <ContextSwitcher
        teams={TIMES}
        pathname={pathname}
        canManageOrg={canManageOrg}
        expanded
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Times e organização" }));
  }

  it("fechado, não há painel nenhum", () => {
    render(
      <ContextSwitcher
        teams={TIMES}
        pathname="/minhas-tarefas"
        canManageOrg
        expanded
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("aberto, lista as áreas e os subtimes com o link certo", () => {
    abrir();
    const seo = screen.getByRole("menuitem", { name: /SEO/ });
    expect(seo.getAttribute("href")).toBe(`/times/${SEO}`);
    expect(screen.getByRole("menuitem", { name: /Marketing/ })).toBeTruthy();
  });

  it("⭐⭐ 'Gerenciar a organização' respeita `area.create`", () => {
    // ⚠️⚠️ ESTE É O TESTE QUE IMPORTA. Ao tirar a entrada do menu, o gate
    // `area.create` veio junto — e um gate que se perde numa mudança de
    // NAVEGAÇÃO é invisível: a tela abre, e só o 403 lá dentro acusa. Pior,
    // no sentido contrário ninguém acusa nada: a porta simplesmente some.
    abrir(true);
    expect(
      screen.getByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeTruthy();

    cleanup();
    abrir(false);
    expect(
      screen.queryByRole("menuitem", { name: "Gerenciar a organização" }),
    ).toBeNull();
    // E os times continuam lá: quem não administra a organização ainda navega.
    expect(screen.getByRole("menuitem", { name: /Marketing/ })).toBeTruthy();
  });

  it("marca onde a pessoa está", () => {
    abrir(true, `/times/${MKT}`);
    const marketing = screen.getByRole("menuitem", { name: /Marketing/ });
    expect(marketing.className).toContain("text-accent");
  });

  it("`aria-expanded` acompanha o estado nos dois sentidos", () => {
    // ⚠️ NÃO AFIRMO "o painel sumiu do DOM": com `AnimatePresence` ele
    // continua montado durante a animação de SAÍDA, e no jsdom essa animação
    // não termina (não há layout, nem quadro). Esperar a remoção aqui seria
    // esperar o motion, não o componente.
    //
    // ⚠️ E `aria-expanded` não é o consolo: é a propriedade que de fato
    // importa. Quem usa leitor de tela ouve "recolhido"/"expandido" por ela,
    // e ela é síncrona.
    abrir();
    const gatilho = screen.getByRole("button", { name: "Times e organização" });
    expect(gatilho.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(gatilho);
    expect(gatilho.getAttribute("aria-expanded")).toBe("false");
  });
});

// SABOTAGENS medidas:
//   A. Ignorar `canManageOrg` e mostrar sempre "Gerenciar a
//      organização". **Cai 1** -- o teste ⭐⭐.
//   B. Incluir os netos na lista (trocar o filtro por `parent_team_id !==
//      null` dentro da área). **Cai 3**.
//   C. Devolver o primeiro time quando a rota não é de time. **Cai 2**: os
//      dois testes de rótulo neutro.
//
// (As três foram executadas, não estimadas.)
