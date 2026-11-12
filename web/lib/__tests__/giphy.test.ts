// Só URL da GIPHY vira <img> no comentário: o resto pode ser pixel de rastreio.
import { describe, expect, it } from "vitest";

import { isGiphyUrl } from "../giphy";

describe("isGiphyUrl", () => {
  it.each([
    "https://giphy.com/gifs/abc",
    "https://media.giphy.com/media/abc/giphy.gif",
    "https://media0.giphy.com/media/abc/200.gif",
  ])("aceita %s", (url) => {
    expect(isGiphyUrl(url)).toBe(true);
  });

  it.each([
    // Termina em "giphy.com" sem o ponto antes.
    "https://eviligiphy.com/a.gif",
    // giphy.com só no começo do domínio.
    "https://giphy.com.evil.com/a.gif",
    "http://media.giphy.com/media/abc/giphy.gif",
    "javascript:alert(1)//giphy.com",
    "não é url",
    "",
  ])("recusa %s", (url) => {
    expect(isGiphyUrl(url)).toBe(false);
  });
});
