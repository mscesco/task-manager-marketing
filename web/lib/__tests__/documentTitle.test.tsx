// Revisão de títulos (21/09) -- o nome da aba.
//
// O que se prende aqui:
//   - o específico vem primeiro, e o produto depois (a aba corta pela direita);
//   - ⚠️ carregando (`null`) NÃO mexe no título: o nome genérico do
//     `layout.tsx` da rota continua valendo até o dado chegar;
//   - ⚠️⚠️ TODA ROTA TEM TÍTULO PRÓPRIO -- o guardião que varre `app/`.
//
// SABOTAGENS (medidas):
//   A. Em `useDocumentTitle`, tirar o `if (!limpo) return`. Deve cair
//      "⚠️ enquanto carrega, o título não muda".
//   B. Apagar o `app/perfil/layout.tsx`. Deve cair "⚠️⚠️ toda rota declara o
//      próprio título".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { APP_NAME, pageTitle } from "@/lib/documentTitle";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

afterEach(() => cleanup());

describe("pageTitle", () => {
  it("põe o nome da tela antes do produto", () => {
    expect(pageTitle("Minhas tarefas")).toBe(`Minhas tarefas · ${APP_NAME}`);
  });

  it("sem nome, é só o produto -- e espaço em branco não conta como nome", () => {
    expect(pageTitle()).toBe(APP_NAME);
    expect(pageTitle(null)).toBe(APP_NAME);
    expect(pageTitle("   ")).toBe(APP_NAME);
  });

  it("apara as pontas", () => {
    expect(pageTitle("  Banner da home  ")).toBe(`Banner da home · ${APP_NAME}`);
  });
});

function Tela({ nome }: { nome: string | null }) {
  useDocumentTitle(nome);
  return <p>tela</p>;
}

describe("useDocumentTitle", () => {
  it("escreve o nome da tela na aba", () => {
    render(<Tela nome="Banner da home" />);
    expect(screen.getByText("tela")).toBeTruthy();
    expect(document.title).toBe(`Banner da home · ${APP_NAME}`);
  });

  it("⚠️ enquanto carrega, o título não muda", () => {
    // O `layout.tsx` da rota já pôs "Tarefa" na aba. Escrever por cima com o
    // produto sozinho seria PERDER informação enquanto o dado não chega.
    document.title = `Tarefa · ${APP_NAME}`;
    render(<Tela nome={null} />);
    expect(document.title).toBe(`Tarefa · ${APP_NAME}`);
  });
});

// =====================================================================
// ⚠️⚠️ O guardião das rotas
// =====================================================================
const APP = join(process.cwd(), "app");

/** Toda pasta de `app/` que tem `page.tsx`, com o caminho da rota. */
function rotas(dir = APP, prefixo = ""): string[] {
  const achadas: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (!statSync(caminho).isDirectory()) continue;
    const rota = `${prefixo}/${nome}`;
    try {
      statSync(join(caminho, "page.tsx"));
      achadas.push(rota);
    } catch {
      /* pasta sem página -- só agrupa */
    }
    achadas.push(...rotas(caminho, rota));
  }
  return achadas;
}

describe("o título de cada rota", () => {
  it("⚠️⚠️ toda rota declara o próprio título", () => {
    // ⚠️ ESTE TESTE É O MOTIVO DE A REVISÃO TER ACHADO O PROBLEMA: as vinte
    // rotas herdavam um título só. Como as páginas são `"use client"` e não
    // podem exportar `metadata`, o título mora no `layout.tsx` da rota -- e
    // esquecer o arquivo não quebra nada visível, só devolve a aba ao nome
    // genérico. Sem guardião, a próxima rota nasceria sem nome.
    const semTitulo = rotas().filter((rota) => {
      const layout = join(APP, rota, "layout.tsx");
      try {
        return !readFileSync(layout, "utf8").includes("title:");
      } catch {
        return true;
      }
    });
    expect(semTitulo).toEqual([]);
  });

  it("o título da rota é só o nome da tela, sem o produto", () => {
    // O produto vem do `title.template` do `app/layout.tsx`. Repeti-lo aqui
    // daria "Projetos · Gestor de Tarefas · Gestor de Tarefas".
    const repetem = rotas().filter((rota) => {
      const layout = join(APP, rota, "layout.tsx");
      try {
        return readFileSync(layout, "utf8").includes(APP_NAME);
      } catch {
        return false;
      }
    });
    expect(repetem).toEqual([]);
  });
});
