import { expect, it } from "vitest";

import { criarUltimaVez } from "../ultimaVez";

it("so o ultimo pedido de cada chave aplica a resposta", () => {
  const vez = criarUltimaVez();
  const primeiro = vez.nova("card-1");
  const outroCard = vez.nova("card-2");
  expect(primeiro()).toBe(true);
  const segundo = vez.nova("card-1");
  expect(primeiro()).toBe(false); // chegou depois: nao mexe no card
  expect(segundo()).toBe(true);
  expect(outroCard()).toBe(true); // chaves nao se atrapalham
});
