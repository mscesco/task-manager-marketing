/**
 * Spec 050, fatia C -- o catalogo gerado esta em dia com a fonte?
 *
 * ⚠️ ESTE E O GUARDIAO DO ARQUIVO GERADO, e o par dele mora no backend
 * (`test_emoji_catalogo_front.py`, que prova que o servidor aceita cada emoji
 * daqui). Aqui a pergunta e outra: o arquivo no disco e o que o gerador
 * produziria hoje? Sem isto, subir a versao do `emojibase-data` deixaria o
 * seletor parado numa lista velha, sem erro nenhum.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// ⚠️ O gerador e `.mjs` de proposito: ele roda em `node` puro, sem passar pelo
// build do front (a fonte e dependencia de desenvolvimento).
import { DESTINO, render, formaCanonica } from "../../scripts/gen-emoji-catalogo.mjs";
import { CATALOGO_DE_EMOJI } from "../emojiCatalogo.generated";

describe("emojiCatalogo.generated", () => {
  it("o arquivo no disco e o que o gerador produz hoje", () => {
    const noDisco = readFileSync(DESTINO, { encoding: "utf-8" });
    expect(noDisco).toBe(render());
  });

  it("tem os emojis que a tela promete, com nome e etiqueta em portugues", () => {
    const joia = CATALOGO_DE_EMOJI.find((e) => e.emoji === "👍");
    expect(joia?.nome).toBe("polegar para cima");
    expect(joia?.tags).toContain("joia");

    const coracao = CATALOGO_DE_EMOJI.find((e) => e.emoji === "❤️");
    expect(coracao?.nome).toBe("coração vermelho");
  });

  it("⚠️ a forma canonica NAO e so tirar o U+FE0F", () => {
    // 👍 perde o U+FE0F que a fonte traz; #️⃣ e a bandeira o MANTEM.
    expect(formaCanonica({ hexcode: "1F44D", type: 1 })).toBe("👍");
    expect(formaCanonica({ hexcode: "2764", type: 0 })).toBe("❤️");
    expect(formaCanonica({ hexcode: "0023-FE0F-20E3", type: 1 })).toBe("#️⃣");
    expect(formaCanonica({ hexcode: "1F3F3-FE0F-200D-1F308", type: 1 })).toBe(
      "🏳️‍🌈",
    );
  });

  it("nao traz componente (tom de pele sozinho) -- o servidor recusa", () => {
    expect(CATALOGO_DE_EMOJI.some((e) => e.emoji === "🏽")).toBe(false);
    expect(CATALOGO_DE_EMOJI.some((e) => e.grupo === "componentes")).toBe(false);
  });

  it("todo item tem emoji, nome e grupo preenchidos", () => {
    const furados = CATALOGO_DE_EMOJI.filter(
      (e) => !e.emoji || !e.nome || !e.grupo,
    );
    expect(furados).toEqual([]);
  });

  it("nao repete emoji", () => {
    const vistos = new Set(CATALOGO_DE_EMOJI.map((e) => e.emoji));
    expect(vistos.size).toBe(CATALOGO_DE_EMOJI.length);
  });
});
