import { describe, expect, it } from "vitest";
import { esperaDeReconexao, lerEventos } from "@/lib/sse";

describe("lerEventos", () => {
  it("lê os eventos completos e guarda o pedaço que ainda não chegou", () => {
    const r = lerEventos('event: ready\ndata: {}\n\ndata: {"kind":"cell.update"}\n\ndata: {"ki');
    expect(r.eventos).toEqual([
      { evento: "ready", dados: "{}" },
      { evento: "message", dados: '{"kind":"cell.update"}' },
    ]);
    expect(r.resto).toBe('data: {"ki');
  });

  it("o resto, completado depois, vira o próximo evento", () => {
    const a = lerEventos('data: {"ki');
    const b = lerEventos(a.resto + 'nd":"undo"}\n\n');
    expect(b.eventos).toEqual([{ evento: "message", dados: '{"kind":"undo"}' }]);
  });

  it("ignora o ping (comentário) e o retry", () => {
    expect(lerEventos(": ping\n\nretry: 3000\n\n").eventos).toEqual([]);
  });

  it("aceita \\r\\n e junta várias linhas de data", () => {
    expect(lerEventos("data: a\r\ndata: b\r\n\r\n").eventos).toEqual([
      { evento: "message", dados: "a\nb" },
    ]);
  });

  it("evento sem data ainda conta (o `end` do servidor)", () => {
    expect(lerEventos("event: end\n\n").eventos).toEqual([{ evento: "end", dados: "" }]);
  });
});

describe("esperaDeReconexao", () => {
  it("dobra até 30 s", () => {
    expect([0, 1, 2, 5, 9].map(esperaDeReconexao)).toEqual([1000, 2000, 4000, 30000, 30000]);
  });
});
