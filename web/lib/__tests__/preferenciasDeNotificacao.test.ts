// Spec 054, fatia D -- a regra do cartao de preferencias (`lib/`).
//
// O que se prende aqui:
//   - sao 24 interruptores + 3 linhas travadas, como a spec conta (§5);
//   - ⚠️ prazo NAO tem coluna de seguidor -- o aviso nunca chega por seguir, e
//     um toggle ali seria um interruptor que nao silencia nada;
//   - ⚠️ celula AUSENTE conta como LIGADO (a ausencia de mute significa ligado
//     no servidor -- D11);
//   - o rotulo acessivel carrega a linha E a coluna;
//   - o resumo nao diz "0".
//
// SABOTAGEM (medida): em `estaLigado`, trocar o `?? true` por `?? false`. Deve
// cair "celula ausente conta como ligada".

import { describe, expect, it } from "vitest";

import type { NotificationToggle } from "@/lib/api";
import {
  COLUNAS,
  LINHAS,
  SECOES,
  estaLigado,
  mapear,
  quantosDesligados,
  resumo,
  rotuloDoToggle,
} from "@/lib/preferenciasDeNotificacao";

function toggle(over: Partial<NotificationToggle> = {}): NotificationToggle {
  return { type_group: "comment", role: "watcher", enabled: true, locked: false, ...over };
}

describe("o catalogo da tela", () => {
  it("tem 24 interruptores e 3 linhas travadas", () => {
    const soltaveis = LINHAS.filter((l) => !l.travada);
    const quantos = soltaveis.reduce((n, l) => n + l.papeis.length, 0);
    expect(quantos).toBe(24);
    expect(LINHAS.filter((l) => l.travada).length).toBe(3);
  });

  it("nao repete grupo, e toda linha vive em uma secao", () => {
    const grupos = LINHAS.map((l) => l.grupo);
    expect(new Set(grupos).size).toBe(grupos.length);
    expect(SECOES.flatMap((s) => s.linhas).length).toBe(LINHAS.length);
  });

  it("⚠️ prazo nao oferece a coluna de seguidor", () => {
    for (const grupo of ["due_soon", "overdue"]) {
      const linha = LINHAS.find((l) => l.grupo === grupo);
      expect(linha?.papeis).toEqual(["assignee", "creator"]);
    }
  });

  it("toda linha travada explica por que", () => {
    for (const linha of LINHAS.filter((l) => l.travada)) {
      expect(linha.ajuda && linha.ajuda.length > 0).toBe(true);
    }
  });
});

describe("estado de cada celula", () => {
  it("⚠️ celula ausente conta como ligada", () => {
    // A resposta nao traz `comment:creator` -- servidor mais antigo, ou grupo
    // novo no front. Dizer "desligado" inventaria um silencio inexistente.
    const mapa = mapear([toggle({ role: "watcher", enabled: false })]);
    expect(estaLigado(mapa, "comment", "creator")).toBe(true);
    expect(estaLigado(mapa, "comment", "watcher")).toBe(false);
  });

  it("le o que a API mandou, papel por papel", () => {
    const mapa = mapear([
      toggle({ role: "watcher", enabled: false }),
      toggle({ role: "assignee", enabled: true }),
    ]);
    expect(estaLigado(mapa, "comment", "watcher")).toBe(false);
    expect(estaLigado(mapa, "comment", "assignee")).toBe(true);
  });
});

describe("resumo e rotulos", () => {
  it("nao conta travado como desligado", () => {
    const lista = [
      toggle({ enabled: false }),
      toggle({ type_group: "mention", role: "none", enabled: false, locked: true }),
    ];
    expect(quantosDesligados(lista)).toBe(1);
    expect(resumo(lista)).toBe("1 aviso desligado.");
  });

  it("sem nada desligado, diz isso em vez de '0'", () => {
    expect(resumo([toggle()])).toBe("Você recebe todos os avisos.");
  });

  it("o rotulo acessivel tem a linha e a coluna", () => {
    const comment = LINHAS.find((l) => l.grupo === "comment")!;
    expect(rotuloDoToggle(comment, "watcher")).toBe("Comentário novo, como seguidor");
    const reaction = LINHAS.find((l) => l.grupo === "reaction")!;
    // Papel unico: sem coluna, o rotulo e so a linha.
    expect(rotuloDoToggle(reaction, "none")).toBe("Reação ao seu comentário");
  });

  it("as colunas sao as tres da spec, nessa ordem", () => {
    expect(COLUNAS.map((c) => c.papel)).toEqual(["watcher", "assignee", "creator"]);
  });
});
