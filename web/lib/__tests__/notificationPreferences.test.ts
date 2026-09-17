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
// SABOTAGEM (medida): em `isEnabled`, trocar o `?? true` por `?? false`. Deve
// cair "celula ausente conta como ligada".

import { describe, expect, it } from "vitest";

import type { NotificationToggle } from "@/lib/api";
import {
  COLUMNS,
  ROWS,
  SECTIONS,
  countDisabled,
  indexToggles,
  isEnabled,
  summary,
  toggleLabel,
} from "@/lib/notificationPreferences";

function toggle(over: Partial<NotificationToggle> = {}): NotificationToggle {
  return { type_group: "comment", role: "watcher", enabled: true, locked: false, ...over };
}

describe("o catalogo da tela", () => {
  it("tem 24 interruptores e 3 linhas travadas", () => {
    const soltaveis = ROWS.filter((r) => !r.locked);
    const quantos = soltaveis.reduce((n, r) => n + r.roles.length, 0);
    expect(quantos).toBe(24);
    expect(ROWS.filter((r) => r.locked).length).toBe(3);
  });

  it("nao repete grupo, e toda linha vive em uma secao", () => {
    const grupos = ROWS.map((r) => r.group);
    expect(new Set(grupos).size).toBe(grupos.length);
    expect(SECTIONS.flatMap((s) => s.rows).length).toBe(ROWS.length);
  });

  it("⚠️ prazo nao oferece a coluna de seguidor", () => {
    for (const grupo of ["due_soon", "overdue"]) {
      const linha = ROWS.find((r) => r.group === grupo);
      expect(linha?.roles).toEqual(["assignee", "creator"]);
    }
  });

  it("toda linha travada explica por que", () => {
    for (const linha of ROWS.filter((r) => r.locked)) {
      expect(linha.help && linha.help.length > 0).toBe(true);
    }
  });
});

describe("estado de cada celula", () => {
  it("⚠️ celula ausente conta como ligada", () => {
    // A resposta nao traz `comment:creator` -- servidor mais antigo, ou grupo
    // novo no front. Dizer "desligado" inventaria um silencio inexistente.
    const mapa = indexToggles([toggle({ role: "watcher", enabled: false })]);
    expect(isEnabled(mapa, "comment", "creator")).toBe(true);
    expect(isEnabled(mapa, "comment", "watcher")).toBe(false);
  });

  it("le o que a API mandou, papel por papel", () => {
    const mapa = indexToggles([
      toggle({ role: "watcher", enabled: false }),
      toggle({ role: "assignee", enabled: true }),
    ]);
    expect(isEnabled(mapa, "comment", "watcher")).toBe(false);
    expect(isEnabled(mapa, "comment", "assignee")).toBe(true);
  });
});

describe("resumo e rotulos", () => {
  it("nao conta travado como desligado", () => {
    const lista = [
      toggle({ enabled: false }),
      toggle({ type_group: "mention", role: "none", enabled: false, locked: true }),
    ];
    expect(countDisabled(lista)).toBe(1);
    expect(summary(lista)).toBe("1 aviso desligado.");
  });

  it("sem nada desligado, diz isso em vez de '0'", () => {
    expect(summary([toggle()])).toBe("Você recebe todos os avisos.");
  });

  it("o rotulo acessivel tem a linha e a coluna", () => {
    const comment = ROWS.find((r) => r.group === "comment")!;
    expect(toggleLabel(comment, "watcher")).toBe("Comentário novo, como seguidor");
    const reaction = ROWS.find((r) => r.group === "reaction")!;
    // Papel unico: sem coluna, o rotulo e so a linha.
    expect(toggleLabel(reaction, "none")).toBe("Reação ao seu comentário");
  });

  it("as colunas sao as tres da spec, nessa ordem", () => {
    expect(COLUMNS.map((c) => c.role)).toEqual(["watcher", "assignee", "creator"]);
  });
});
