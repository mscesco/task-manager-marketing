// A fila de triagem `/solicitacoes` (Spec 043, fatia C2-c).
//
// ⚠️⚠️ **ESTA TELA NÃO TINHA TESTE NENHUM ATÉ AQUI**, e descobri isso do pior
// jeito possível: troquei a fonte do rótulo da categoria e a suíte foi de 1020
// para 1020. Nada se mexeu porque nada olhava para cá.
//
// É a tela em que o trabalho acontece -- é dela que o Marketing tria tudo que
// chega -- e ela vinha sendo alterada sem rede. Este arquivo não cobre a fila
// inteira; cobre o que esta fatia mexeu, que é como a categoria aparece, mais
// as duas ações que a tela existe para fazer.
//
// ⚠️ E O HOP QUE ELE PRENDE É O MESMO QUE JÁ ME ESCAPOU DUAS VEZES NESTA SPEC:
// não "o dado chega ao componente", e sim "o componente DESENHA o dado que
// veio". Na fatia B a sabotagem do `form_id` passou verde por essa distinção.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SolicitacoesPage from "@/app/solicitacoes/page";
import type { Batch, BatchItem } from "@/lib/api";

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listarEnvios: vi.fn(),
    aprovarSolicitacao: vi.fn(),
    rejeitarSolicitacao: vi.fn(),
    marcarTarefaCriada: vi.fn(),
  };
});

const api = await import("@/lib/api");

function item(over: Partial<BatchItem> = {}): BatchItem {
  return {
    id: "i1",
    batch_seq: 1,
    category: "foto",
    category_title: "Fotografia",
    category_emoji: "📷",
    category_sla: "5 dias úteis",
    summary: "Preciso de fotos do evento",
    status: "PENDING",
    answers: [{ label: "O que precisa?", value: "fotos" }],
    review_note: null,
    reviewed_at: null,
    task_created_at: null,
    task_ref: null,
    ...over,
  };
}

function envio(itens: BatchItem[] = [item()]): Batch {
  return {
    batch_id: "b1",
    protocol: "ABC123",
    requester_name: "Maria do Polo",
    requester_email: "maria@polo.ex",
    requester_phone: "11999990000",
    requester_department: "Coordenação",
    requester_polo: "Taboão",
    created_at: "2026-08-26T12:00:00Z",
    items: itens,
  };
}

/**
 * ⚠️ O CARD NASCE FECHADO, e abrir faz parte de montar a cena.
 *
 * Fechado ele mostra quem pediu e os tópicos do que pediu; prazo, respostas e
 * as ações de triagem só existem abertos. Os três primeiros testes que escrevi
 * aqui falharam por isso -- procuravam "Aprovar" numa tela que ainda não o
 * tinha desenhado.
 */
async function abrirOCard() {
  fireEvent.click(await screen.findByText("Maria do Polo"));
}

function montar(itens: BatchItem[] = [item()]) {
  vi.mocked(api.listarEnvios).mockResolvedValue({
    items: [envio(itens)],
    total: 1,
    page: 1,
    size: 10,
    pending_total: 1,
    approved_without_task_total: 0,
  });
  render(<SolicitacoesPage />);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("a categoria vem do BANCO, e não de um arquivo do front", () => {
  it("⚠️ desenha o título que a API resolveu, e não o slug", async () => {
    // ⚠️ ANTES DISTO A FILA LIA `CATEGORIA_POR_SLUG`, estático. Funcionava só
    // porque a migration 0017 copiou os mesmos slugs -- e a primeira seção
    // criada pelo editor apareceria como slug cru, sozinha e feia no meio das
    // outras.
    montar();
    expect(await screen.findAllByText(/Fotografia/)).not.toHaveLength(0);
    expect(screen.queryByText("foto")).toBeNull();
  });

  it("⚠️ uma categoria SEM rótulo mostra o slug, e não some da fila", async () => {
    // Seção apagada, ou categoria que não existe mais em formulário nenhum.
    // Esconder o item apagaria da tela um pedido que alguém fez de verdade.
    montar([
      item({
        category: "categoria-sumida",
        category_title: null,
        category_emoji: null,
        category_sla: null,
      }),
    ]);
    expect(await screen.findAllByText(/categoria-sumida/)).not.toHaveLength(0);
  });

  it("o prazo da seção aparece quando existe", async () => {
    montar();
    await abrirOCard();
    expect(await screen.findByText(/5 dias úteis/)).toBeTruthy();
  });

  it("⚠️ e NÃO aparece quando a seção não promete prazo", async () => {
    // `sla_text` nulo é "sem promessa". Inventar um prazo padrão aqui seria a
    // fila prometendo em nome de quem montou o formulário.
    montar([item({ category_sla: null })]);
    await abrirOCard();
    await screen.findAllByText(/Fotografia/);
    expect(screen.queryByText(/dias úteis/)).toBeNull();
  });
});

describe("as duas ações que a fila existe para fazer", () => {
  it("aprovar chama a API e recarrega", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    montar();
    await abrirOCard();
    fireEvent.click(await screen.findByText("Aprovar"));
    await waitFor(() => expect(api.aprovarSolicitacao).toHaveBeenCalledWith("i1"));
    // ⚠️ RECARREGA em vez de costurar o novo status no estado local: aprovar
    // muda contadores (`pending_total`) que a tela também mostra.
    await waitFor(() => expect(api.listarEnvios).toHaveBeenCalledTimes(2));
  });

  it("⚠️ rejeitar EXIGE justificativa -- é o que a pessoa vai receber", async () => {
    // ⚠️ A RECUSA É NO CLIQUE, COM MENSAGEM, e não com botão cinza -- eu tinha
    // escrito este teste presumindo `disabled` e ele reprovou. O desenho da
    // tela é melhor que o meu palpite: um botão cinza não diz o que falta, e
    // aqui a frase "a rejeição exige uma justificativa" diz.
    montar();
    await abrirOCard();
    fireEvent.click(await screen.findByText("Rejeitar"));
    fireEvent.click(await screen.findByText("Confirmar rejeição"));

    expect(await screen.findByText(/exige uma justificativa/i)).toBeTruthy();
    expect(api.rejeitarSolicitacao).not.toHaveBeenCalled();
  });

  it("com justificativa, rejeitar vai -- e leva o texto aparado", async () => {
    vi.mocked(api.rejeitarSolicitacao).mockResolvedValue({} as never);
    montar();
    await abrirOCard();
    fireEvent.click(await screen.findByText("Rejeitar"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  fora do escopo  " },
    });
    fireEvent.click(screen.getByText("Confirmar rejeição"));

    await waitFor(() =>
      expect(api.rejeitarSolicitacao).toHaveBeenCalledWith("i1", "fora do escopo")
    );
  });
});
