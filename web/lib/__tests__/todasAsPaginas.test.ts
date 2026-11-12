import { describe, expect, it, vi } from "vitest";

import { todasAsPaginas } from "../todasAsPaginas";

const item = (n: number) => ({ id: `c${n}` });

describe("todasAsPaginas", () => {
  it("passa da primeira pagina quando o total e maior", async () => {
    const todos = Array.from({ length: 5 }, (_, i) => item(i));
    const buscar = vi.fn(async (page: number, size: number) => ({
      items: todos.slice((page - 1) * size, page * size),
      total: todos.length,
    }));
    expect(await todasAsPaginas(buscar, 2)).toEqual(todos);
    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("uma pagina so quando cabe, e sem repetir o item que escorregou de pagina", async () => {
    expect(
      await todasAsPaginas(async () => ({ items: [item(1)], total: 1 }), 2),
    ).toEqual([item(1)]);
    const paginas = [[item(1), item(2)], [item(2), item(3)]];
    expect(
      await todasAsPaginas(async (page) => ({ items: paginas[page - 1], total: 4 }), 2),
    ).toEqual([item(1), item(2), item(3)]);
  });
});
