// O rótulo da categoria na fila vem do que o backend resolveu no banco; o slug
// cru é só a reserva.

import { describe, expect, it } from "vitest";

import type { BatchItem } from "../api";
import { numeroDaRepeticao, rotuloDaCategoria } from "../rotuloDaCategoria";

function item(over: Partial<BatchItem> = {}): BatchItem {
  return {
    id: "i1",
    batch_seq: 1,
    category: "foto",
    category_title: "Fotografia",
    category_emoji: "📷",
    category_sla: "5 dias úteis",
    summary: "Preciso de fotos",
    status: "PENDING",
    answers: [],
    review_note: null,
    reviewed_at: null,
    task_created_at: null,
    task_ref: null,
    task_id: null,
    task_title: null,
    ...over,
  };
}

describe("rotuloDaCategoria", () => {
  it("usa o que o backend resolveu", () => {
    expect(rotuloDaCategoria(item())).toEqual({
      titulo: "Fotografia",
      emoji: "📷",
      prazo: "5 dias úteis",
    });
  });

  it("⚠️ sem rótulo, cai no SLUG CRU -- e isso é honesto, não é falha", () => {
    // `category_title` vem `null` quando a seção foi apagada, ou quando o
    // pedido é de uma categoria que não existe mais em formulário nenhum.
    // Mostrar o slug é feio; esconder o item apagaria da tela um pedido que
    // alguém fez de verdade.
    const r = rotuloDaCategoria(
      item({ category_title: null, category_emoji: null, category_sla: null })
    );
    expect(r.titulo).toBe("foto");
    expect(r.emoji).toBe("❓");
    expect(r.prazo).toBeNull();
  });

  it("⚠️ emoji VAZIO é escolha de quem montou a seção, e não falta", () => {
    // Por isso `??` e não `||`. Trocar por "❓" um emoji deixado em branco de
    // propósito seria a tela discordando de quem montou o formulário.
    expect(rotuloDaCategoria(item({ category_emoji: "" })).emoji).toBe("");
  });

  it("⚠️ o TÍTULO manda, mesmo quando difere do slug -- é renomear funcionando", () => {
    // O slug fica gravado no pedido e não muda; o título é resolvido na hora,
    // então renomear a seção arruma a fila inteira, inclusive pedidos antigos.
    const r = rotuloDaCategoria(item({ category: "foto", category_title: "Fotografia" }));
    expect(r.titulo).toBe("Fotografia");
  });
});

describe("numeroDaRepeticao", () => {
  it("vazio quando a seção aparece uma vez no envio", () => {
    const a = item({ id: "a", category: "foto", batch_seq: 1 });
    const b = item({ id: "b", category: "arte", batch_seq: 2 });
    expect(numeroDaRepeticao([a, b], a)).toBe("");
  });

  it("numera as repetições na ordem do batch_seq", () => {
    const e2 = item({ id: "e2", category: "evento", batch_seq: 3 });
    const a = item({ id: "a", category: "arte", batch_seq: 1 });
    const e1 = item({ id: "e1", category: "evento", batch_seq: 2 });
    const todos = [e2, a, e1];
    expect(numeroDaRepeticao(todos, e1)).toBe(" #1");
    expect(numeroDaRepeticao(todos, e2)).toBe(" #2");
    expect(numeroDaRepeticao(todos, a)).toBe("");
  });
});
