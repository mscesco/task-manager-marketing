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
    andarSolicitacao: vi.fn(),
    criarTarefaDaSolicitacao: vi.fn(),
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
    task_id: null,
    task_title: null,
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

// =====================================================================
// ⚠️ Em andamento e Concluída (Spec 043, fatia D)
// =====================================================================
describe("o andamento de um pedido ACEITO", () => {
  it("⚠️ o seletor oferece os TRÊS aceitos, e não um botão 'avançar'", async () => {
    // Volta-se de "concluída" para "em andamento" de propósito: marcar
    // concluída por engano é comum, e sem a volta a saída seria pedir para
    // alguém mexer no banco.
    montar([item({ status: "DONE" })]);
    await abrirOCard();
    const select = (await screen.findByLabelText(
      "Situação de Fotografia"
    )) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Aprovada",
      "Em andamento",
      "Concluída",
    ]);
    expect(select.value).toBe("DONE");
  });

  it("mudar a situação chama a rota de ANDAMENTO, e não a de aprovar", async () => {
    // ⚠️ SÃO ROTAS DIFERENTES porque são trabalhos diferentes: aprovar grava
    // QUEM decidiu e QUANDO; andar não toca nesses campos. Reaproveitar
    // `/aprovar` reescreveria a decisão a cada mudança de andamento.
    vi.mocked(api.andarSolicitacao).mockResolvedValue({} as never);
    montar([item({ status: "APPROVED" })]);
    await abrirOCard();
    fireEvent.change(await screen.findByLabelText("Situação de Fotografia"), {
      target: { value: "IN_PROGRESS" },
    });

    await waitFor(() =>
      expect(api.andarSolicitacao).toHaveBeenCalledWith("i1", "IN_PROGRESS")
    );
    expect(api.aprovarSolicitacao).not.toHaveBeenCalled();
  });

  it("⚠️ pedido PENDENTE não tem seletor -- falta triar antes", async () => {
    montar([item({ status: "PENDING" })]);
    await abrirOCard();
    await screen.findByText("Aprovar");
    expect(screen.queryByLabelText("Situação de Fotografia")).toBeNull();
  });

  it("⚠️ pedido REJEITADO também não -- não há reabertura neste produto", async () => {
    montar([item({ status: "REJECTED", review_note: "fora do escopo" })]);
    await abrirOCard();
    expect(screen.queryByLabelText("Situação de Fotografia")).toBeNull();
  });

  it("⚠️ as ações de tarefa aparecem com o pedido EM ANDAMENTO", async () => {
    // A tarefa costuma ser criada quando o trabalho COMEÇA. A condição antiga
    // era `status === "APPROVED"` e escondia os botões exatamente no momento
    // em que eles são usados.
    //
    // ⚠️ O RÓTULO MUDOU NA FATIA E ("Marcar tarefa criada" -> "Já criei — só
    // marcar", com "Criar tarefa" assumindo o lugar principal), e foi este
    // teste que avisou. Deixei-o apontando para os DOIS botões: o que importa
    // aqui é que o pedido em andamento tenha o que fazer, e não como o botão
    // secundário se chama hoje.
    montar([item({ status: "IN_PROGRESS" })]);
    await abrirOCard();
    expect(await screen.findByText("Criar tarefa")).toBeTruthy();
    expect(screen.getByText("Já criei — só marcar")).toBeTruthy();
  });

  it("os dois status novos têm rótulo em português", async () => {
    montar([item({ status: "IN_PROGRESS" })]);
    await abrirOCard();
    expect(await screen.findAllByText("Em andamento")).not.toHaveLength(0);
  });
});

// =====================================================================
// ⚠️ A tarefa DE VERDADE (Spec 043, fatia E)
// =====================================================================
describe("criar a tarefa a partir do pedido", () => {
  it("⚠️ 'Criar tarefa' é o caminho PRINCIPAL, e 'já criei' o secundário", async () => {
    // ⚠️ O FLUXO ANTIGO ERA DE SEIS PASSOS: copiar o briefing, sair da fila,
    // abrir o quadro, criar a tarefa, colar, voltar e marcar. O último era o
    // que mais se esquecia -- é a razão de o filtro "aprovadas sem tarefa"
    // existir. Ele continua disponível, mas deixou de ser o único.
    montar([item({ status: "APPROVED" })]);
    await abrirOCard();
    expect(await screen.findByText("Criar tarefa")).toBeTruthy();
    expect(screen.getByText("Já criei — só marcar")).toBeTruthy();
  });

  it("cria e oferece ABRIR A TAREFA, sem um segundo request", async () => {
    vi.mocked(api.criarTarefaDaSolicitacao).mockResolvedValue({
      task_id: "t-9",
      task_title: "[Fotografia] Preciso de fotos do evento",
    });
    montar([item({ status: "APPROVED" })]);
    await abrirOCard();
    fireEvent.click(await screen.findByText("Criar tarefa"));

    await waitFor(() =>
      expect(api.criarTarefaDaSolicitacao).toHaveBeenCalledWith("i1")
    );
    const abrir = await screen.findByText("Abrir a tarefa");
    expect(abrir.getAttribute("href")).toBe("/tarefa/t-9");
  });

  it("⚠️ pedido PENDENTE não oferece criar -- falta triar antes", async () => {
    montar([item({ status: "PENDING" })]);
    await abrirOCard();
    await screen.findByText("Aprovar");
    expect(screen.queryByText("Criar tarefa")).toBeNull();
  });

  it("⚠️ a tarefa vinculada VIRA LINK, e não texto", async () => {
    // O `task_ref` era texto livre: não dava para clicar, não seguia a tarefa
    // quando ela era renomeada e não sabia dizer se ela ainda existia.
    montar([
      item({
        status: "IN_PROGRESS",
        task_created_at: "2026-08-27T10:00:00Z",
        task_id: "t-1",
        task_title: "[Fotografia] Fotos do evento",
      }),
    ]);
    await abrirOCard();
    const link = await screen.findByText("[Fotografia] Fotos do evento");
    expect(link.getAttribute("href")).toBe("/tarefa/t-1");
  });

  it("⚠️ tarefa APAGADA não vira link que leva a lugar nenhum", async () => {
    // `task_title` vem `null` quando a tarefa foi apagada. Um link para ela
    // seria uma promessa falsa; o texto sem link diz a verdade.
    montar([
      item({
        status: "APPROVED",
        task_created_at: "2026-08-27T10:00:00Z",
        task_id: "t-1",
        task_title: null,
      }),
    ]);
    await abrirOCard();
    expect(await screen.findByText(/tarefa vinculada/)).toBeTruthy();
    expect(document.querySelector('a[href="/tarefa/t-1"]')).toBeNull();
  });

  it("⚠️ marcação ANTIGA, só com `task_ref` de texto, continua aparecendo", async () => {
    // LEGADO VIVO: as marcações anteriores a esta fatia moram no `task_ref` e
    // não há como convertê-las em id. Apagar a coluna perderia o único rastro
    // que aquelas solicitações têm.
    montar([
      item({
        status: "APPROVED",
        task_created_at: "2026-07-22T10:00:00Z",
        task_id: null,
        task_title: null,
        task_ref: "quadro do Design",
      }),
    ]);
    await abrirOCard();
    expect(await screen.findByText(/quadro do Design/)).toBeTruthy();
  });
});

// =====================================================================
// ⚠️ Os campos que a fatia G tornou opcionais
// =====================================================================
describe("um envio SEM telefone, área e polo", () => {
  // ⚠️⚠️ ESTE BLOCO NASCEU DA REVISÃO DE 31/08, e o motivo de ela ter achado
  // e eu não é direto: **todas as fixtures deste arquivo preenchiam os cinco
  // campos**. A tipagem mudou na fatia G, os escritores foram migrados, e
  // nenhuma asserção exercitava o `null` -- o mesmo hop que esta spec já
  // registrou três vezes, agora na direção "o tipo mudou e o leitor não".
  function envioMagro() {
    return {
      items: [
        {
          ...envio().items[0],
        },
      ],
      batch_id: "b1",
      protocol: "ABC123",
      requester_name: "Maria",
      requester_email: "maria@polo.ex",
      requester_phone: null,
      requester_department: null,
      requester_polo: null,
      created_at: "2026-08-26T12:00:00Z",
    } as unknown as Batch;
  }

  function montarMagro() {
    vi.mocked(api.listarEnvios).mockResolvedValue({
      items: [envioMagro()],
      total: 1,
      page: 1,
      size: 10,
      pending_total: 1,
      approved_without_task_total: 0,
    });
    render(<SolicitacoesPage />);
  }

  it("⚠️ o card não mostra separador pendurado", async () => {
    // Em JSX o `null` some, mas o `·` e o `/` FICAM: o card mostrava
    // "maria@polo.ex ·  / ".
    montarMagro();
    await screen.findByText("Maria");
    expect(document.body.textContent).not.toMatch(/·\s*\/\s*$/m);
    expect(document.body.textContent).not.toContain("· /");
  });

  it("⚠️ o briefing copiado NÃO contém a string \"null\"", async () => {
    // ⚠️ TEMPLATE LITERAL COM `null` ESCREVE "null". Este texto vai para a área
    // de transferência e daí para o WhatsApp -- ou seja, vaza para FORA do
    // sistema, até o solicitante.
    const escrito: string[] = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: (t: string) => {
          escrito.push(t);
          return Promise.resolve();
        },
      },
    });

    montarMagro();
    fireEvent.click(await screen.findByText("Maria"));
    fireEvent.click(await screen.findByText("Copiar briefing"));

    await waitFor(() => expect(escrito).toHaveLength(1));
    expect(escrito[0]).not.toContain("null");
    // ⚠️ E A LINHA DE ÁREA/POLO SOME INTEIRA -- "Área:  · Polo: " vazio parece
    // dado perdido.
    expect(escrito[0]).not.toContain("Área:");
    expect(escrito[0]).toContain("maria@polo.ex");
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
