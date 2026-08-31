/**
 * O rótulo da categoria na fila (Spec 043, fatia C2-c).
 *
 * ⚠️⚠️ **A FILA NÃO TINHA TESTE NENHUM.** Descobri isso ao trocar a fonte do
 * rótulo e ver a suíte marcar 1020 → 1020: nada se mexeu porque nada olhava
 * para lá. `/solicitacoes` é a tela onde o trabalho realmente acontece — é
 * dela que o Marketing tria tudo — e ela vinha sendo reescrita sem rede.
 *
 * ⚠️ E O DEFEITO QUE ESTA FATIA CONSERTA ERA INVISÍVEL: a fila lia
 * `CATEGORIA_POR_SLUG`, um arquivo estático, enquanto o formulário público já
 * lia o banco desde a fatia B. Funcionava porque a migration 0017 copiou os
 * mesmos slugs. A primeira seção criada pelo editor da fatia C2 apareceria ali
 * como slug cru e "❓" — e só ela, ao lado das outras bonitas.
 */

import { describe, expect, it } from "vitest";

import type { BatchItem } from "../api";
import { rotuloDaCategoria } from "../rotuloDaCategoria";

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
    // O slug fica gravado no pedido e não muda; o título é resolvido na hora.
    // Renomear "Foto" para "Fotografia" arruma a fila inteira, inclusive os
    // pedidos de julho. É a razão de um campo ser permanente e o outro não.
    const r = rotuloDaCategoria(item({ category: "foto", category_title: "Fotografia" }));
    expect(r.titulo).toBe("Fotografia");
  });
});
