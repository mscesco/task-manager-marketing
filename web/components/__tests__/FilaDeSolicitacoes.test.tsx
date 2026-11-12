// A fila de triagem `/solicitacoes`: como a categoria aparece, as abas e a
// busca, e as ações de triagem. O que se prende é "o componente DESENHA o dado
// que veio", e não só "o dado chega ao componente".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import SolicitacoesPage from "@/app/solicitacoes/page";
import type { Batch, BatchItem } from "@/lib/api";
import {
  ActiveTeamProvider,
  type ActiveTeamContext,
} from "@/lib/useActiveTeam";

// O mock fornece o contexto de time, porque o `AppShell` de verdade fornece. Sem isto a tela fica em `Loading` para sempre:
// ela ESPERA o time ativo antes de buscar, e um passa-tudo nunca o entrega.
//
// O valor precisa ser RESOLVIDO (`kind: "team"`), não `null`: `null`
// significa "a barra ainda não sabe", que é o estado de espera.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <ActiveTeamProvider value={contextoDoTeste}>{children}</ActiveTeamProvider>
  ),
}));

/**
 * O contexto que o `AppShell` falso entrega, MUTÁVEL pelo teste.
 *
 * Variável em vez de valor fixo porque três testes precisam de valores
 * DIFERENTES (time resolvido, `kind: "none"`, e `null`), e a fábrica do
 * `vi.mock` é içada -- não dá para parametrizá-la por teste. A fábrica não LÊ
 * a variável (só o corpo do componente lê, no render), então não há TDZ.
 */
let contextoDoTeste: ActiveTeamContext = {
  active: { kind: "team", teamId: "team-da-fila", fromUrl: true },
  search: "?time=team-da-fila",
  teamName: "Marketing",
        teams: [],
      };

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
 * O painel nasce vazio: prazo, respostas e ações de triagem só existem no painel
 * do envio escolhido, então escolher o envio faz parte de montar a cena.
 */
async function abrirOCard() {
  fireEvent.click(await screen.findByText("Maria do Polo"));
}

/** O painel do envio escolhido -- "Rejeitar" também existe na linha da lista. */
function painel() {
  return within(screen.getByRole("region", { name: "Envio escolhido" }));
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

describe("o formulário de origem", () => {
  it("o card diz por qual formulário o envio entrou", async () => {
    vi.mocked(api.listarEnvios).mockResolvedValue({
      items: [{ ...envio(), form_id: "f1", form_title: "Solicitação ao Marketing" }],
      total: 1,
      page: 1,
      size: 10,
      pending_total: 1,
      approved_without_task_total: 0,
    });
    render(<SolicitacoesPage />);
    expect(await screen.findByText("Solicitação ao Marketing")).toBeTruthy();
  });

  it("pedido antigo, sem formulário, não mostra rótulo vazio", async () => {
    montar();
    await screen.findByText("Maria do Polo");
    expect(screen.queryByText(/Formulário/)).toBeNull();
  });
});

describe("abas, busca e formulário", () => {
  it("trocar de aba pede a situação ao servidor", async () => {
    montar();
    await screen.findByText("Maria do Polo");
    fireEvent.click(screen.getByRole("tab", { name: /Em andamento/ }));
    await waitFor(() =>
      expect(api.listarEnvios).toHaveBeenLastCalledWith(expect.objectContaining({ filtro: "ACTIVE" }))
    );
  });

  it("os números das abas vêm do servidor", async () => {
    vi.mocked(api.listarEnvios).mockResolvedValue({
      items: [envio()],
      total: 1,
      page: 1,
      size: 20,
      pending_total: 1,
      approved_without_task_total: 0,
      tab_totals: { PENDING: 7, ACTIVE: 12, DONE: 48, REJECTED: 3, ALL: 70, WITHOUT_TASK: 4 },
    });
    render(<SolicitacoesPage />);
    expect((await screen.findByRole("tab", { name: /Concluídas/ })).textContent).toContain("48");
  });

  it("a busca vai ao servidor depois que a pessoa para de digitar", async () => {
    montar();
    await screen.findByText("Maria do Polo");
    fireEvent.change(screen.getByLabelText("Buscar solicitações"), { target: { value: "FBC3" } });
    await waitFor(() =>
      expect(api.listarEnvios).toHaveBeenLastCalledWith(expect.objectContaining({ busca: "FBC3" }))
    );
  });

  it("'só sem tarefa' não aparece em Pendentes, onde não faz sentido", async () => {
    montar();
    await screen.findByText("Maria do Polo");
    expect(screen.queryByLabelText(/Só sem tarefa/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Todas/ }));
    fireEvent.click(await screen.findByLabelText(/Só sem tarefa/));
    await waitFor(() =>
      expect(api.listarEnvios).toHaveBeenLastCalledWith(expect.objectContaining({ semTarefa: true }))
    );
  });
});

describe("a lista não mente quando o servidor demora", () => {
  function pagina(nome: string) {
    return {
      items: [{ ...envio(), requester_name: nome }],
      total: 1,
      page: 1,
      size: 20,
      pending_total: 1,
      approved_without_task_total: 0,
    };
  }

  it("⚠️ a resposta ATRASADA da aba anterior não sobrescreve a da aba nova", async () => {
    let soltarPendentes!: (v: ReturnType<typeof pagina>) => void;
    let soltarRejeitadas!: (v: ReturnType<typeof pagina>) => void;
    vi.mocked(api.listarEnvios)
      .mockImplementationOnce(() => new Promise((r) => (soltarPendentes = r)))
      .mockImplementationOnce(() => new Promise((r) => (soltarRejeitadas = r)));
    render(<SolicitacoesPage />);
    await waitFor(() => expect(api.listarEnvios).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("tab", { name: /Rejeitadas/ }));
    await waitFor(() => expect(api.listarEnvios).toHaveBeenCalledTimes(2));

    soltarRejeitadas(pagina("Rita Rejeitada"));
    expect(await screen.findByText("Rita Rejeitada")).toBeTruthy();
    await act(async () => {
      soltarPendentes(pagina("Maria Pendente"));
    });
    expect(screen.queryByText("Maria Pendente")).toBeNull();
    expect(screen.getByText("Rita Rejeitada")).toBeTruthy();
  });

  it("⚠️ trocar de aba na página 2 busca UMA vez, já na página 1", async () => {
    vi.mocked(api.listarEnvios).mockResolvedValue({ ...pagina("Maria do Polo"), total: 45 });
    render(<SolicitacoesPage />);
    fireEvent.click(await screen.findByText("Próxima →"));
    await waitFor(() =>
      expect(api.listarEnvios).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    );
    await screen.findByText("Maria do Polo");
    vi.mocked(api.listarEnvios).mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /Concluídas/ }));
    await act(async () => {});
    expect(api.listarEnvios).toHaveBeenCalledTimes(1);
    expect(api.listarEnvios).toHaveBeenCalledWith(expect.objectContaining({ filtro: "DONE", page: 1 }));
  });
});

describe("as abas das demandas no painel", () => {
  // O jsdom não calcula layout, então o teste guarda a CLASSE: sem
  // `shrink-0`, a barra com `overflow-x-auto` encolhia até zero no painel que
  // rola por dentro, e as outras demandas do envio ficavam inalcançáveis.
  it("⚠️ a barra das abas não encolhe quando as respostas são longas", async () => {
    montar([item(), item({ id: "i2", batch_seq: 2, category: "arte", category_title: "Arte" })]);
    await abrirOCard();
    const abas = await screen.findByRole("tablist", { name: "Demandas do envio" });
    expect(abas.className).toContain("shrink-0");
    expect(within(abas).getAllByRole("tab")).toHaveLength(2);
  });
});

describe("o atalho do cabeçalho", () => {
  it("⚠️ leva a `/formularios`, e NÃO a um `/solicitar` fixo", async () => {
    // Há um formulário por time: um link fixo mostraria sempre o mesmo. A
    // segunda asserção cai se o atalho antigo voltar. Consulta por LINK, e não
    // por texto: "formulário público" aparece legitimamente no estado vazio.
    montar();
    const atalho = await screen.findByRole("link", {
      name: "Gerenciar formulários",
    });
    // Leva o `?time=`, senão a lista de formulários cai na reserva.
    expect(atalho.getAttribute("href")).toBe("/formularios?time=team-da-fila");
    expect(
      screen.queryAllByRole("link", { name: /formulário público/i })
    ).toHaveLength(0);
  });
});

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
    // Rotas diferentes porque são trabalhos diferentes: aprovar grava
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
    await screen.findByText("Aprovar e criar tarefa");
    expect(screen.queryByLabelText("Situação de Fotografia")).toBeNull();
  });

  it("⚠️ pedido REJEITADO também não -- não há reabertura neste produto", async () => {
    montar([item({ status: "REJECTED", review_note: "fora do escopo" })]);
    await abrirOCard();
    expect(screen.queryByLabelText("Situação de Fotografia")).toBeNull();
  });

  it("⚠️ as ações de tarefa aparecem com o pedido EM ANDAMENTO", async () => {
    // A tarefa costuma ser criada quando o trabalho COMEÇA: as ações de tarefa
    // não podem ficar só no APPROVED.
    montar([item({ status: "IN_PROGRESS" })]);
    await abrirOCard();
    expect(await screen.findByText("Criar tarefa")).toBeTruthy();
    expect(screen.getByText("Já criei — só marcar")).toBeTruthy();
  });
});

describe("criar a tarefa a partir do pedido", () => {
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
    await screen.findByText("Aprovar e criar tarefa");
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
    // Marcações antigas moram só no `task_ref`, sem id: é o único rastro delas.
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

describe("um envio SEM telefone, área e polo", () => {
  // As outras fixtures preenchem os cinco campos; aqui o `null` é exercitado.
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

  it("⚠️ com os dois campos, o separador entre eles é `/`", async () => {
    // Os dois separadores são diferentes de propósito: `·` separa o e-mail do
    // lugar, `/` separa área de polo.
    montar();
    await abrirOCard();
    expect(document.body.textContent).toContain("Coordenação / Taboão");
  });

  it("⚠️ o card não mostra separador pendurado", async () => {
    // Em JSX o `null` some, mas o `·` e o `/` FICAM: o card mostrava
    // "maria@polo.ex ·  / ".
    montarMagro();
    fireEvent.click(await screen.findByText("Maria"));
    await screen.findByText("Copiar briefing");
    expect(document.body.textContent).not.toMatch(/·\s*\/\s*$/m);
    expect(document.body.textContent).not.toContain("· /");
  });

  it("⚠️ o briefing copiado NÃO contém a string \"null\"", async () => {
    // Template literal com `null` escreve "null", e este texto sai do sistema
    // (área de transferência -> WhatsApp).
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
    // E a linha de área/polo some inteira -- "Área:  · Polo: " vazio parece
    // dado perdido.
    expect(escrito[0]).not.toContain("Área:");
    expect(escrito[0]).toContain("maria@polo.ex");
  });
});

describe("as duas ações que a fila existe para fazer", () => {
  it("'Aprovar e criar tarefa' aprova E cria, e oferece abrir a tarefa", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    vi.mocked(api.criarTarefaDaSolicitacao).mockResolvedValue({
      task_id: "t-7",
      task_title: "[Fotografia] Preciso de fotos do evento",
    });
    montar();
    await abrirOCard();
    fireEvent.click(await screen.findByText("Aprovar e criar tarefa"));
    await waitFor(() => expect(api.criarTarefaDaSolicitacao).toHaveBeenCalledWith("i1"));
    expect(api.aprovarSolicitacao).toHaveBeenCalledWith("i1");
    expect((await screen.findByText("Abrir a tarefa")).getAttribute("href")).toBe("/tarefa/t-7");
  });

  it("'Aprovar sem tarefa' (na seta) só aprova, e recarrega", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    montar();
    await abrirOCard();
    fireEvent.click(await screen.findByLabelText("Outras formas de aprovar"));
    fireEvent.click(await screen.findByText("Aprovar sem tarefa"));
    await waitFor(() => expect(api.aprovarSolicitacao).toHaveBeenCalledWith("i1"));
    expect(api.criarTarefaDaSolicitacao).not.toHaveBeenCalled();
    // Recarrega em vez de costurar o novo status no estado local: aprovar
    // muda os números das abas, que a tela também mostra.
    await waitFor(() =>
      expect(vi.mocked(api.listarEnvios).mock.calls.length).toBeGreaterThan(1)
    );
  });

  it("⚠️ aprovar em A e abrir B enquanto A recarrega: o painel FICA em B", async () => {
    // O `recarregar` relê A pelo protocolo; ao chegar, não pode devolver o painel para A.
    const a = envio();
    const b = { ...envio(), batch_id: "b2", protocol: "XYZ789", requester_name: "João do Polo" };
    const lista = { items: [a, b], total: 2, page: 1, size: 10, pending_total: 2, approved_without_task_total: 0 };
    let soltarA!: (r: typeof lista) => void;
    const buscaDeA = new Promise<typeof lista>((s) => {
      soltarA = s;
    });
    vi.mocked(api.listarEnvios).mockImplementation(async (q) =>
      q.busca === "ABC123" ? buscaDeA : lista
    );
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    render(<SolicitacoesPage />);
    await abrirOCard();
    fireEvent.click(await screen.findByLabelText("Outras formas de aprovar"));
    fireEvent.click(await screen.findByText("Aprovar sem tarefa"));
    await waitFor(() => expect(api.aprovarSolicitacao).toHaveBeenCalledWith("i1"));

    fireEvent.click(screen.getByText("João do Polo"));
    await act(async () => {
      soltarA({ ...lista, items: [a] });
    });
    expect(painel().getByText("João do Polo")).toBeTruthy();
  });

  it("⚠️ ✓ na LISTA só aprova -- a tarefa se cria no painel", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    montar();
    fireEvent.click(await screen.findByLabelText("Aprovar"));
    await waitFor(() => expect(api.aprovarSolicitacao).toHaveBeenCalledWith("i1"));
    expect(api.criarTarefaDaSolicitacao).not.toHaveBeenCalled();
  });

  it("⚠️ o segundo clique de um clique DUPLO no ✓ não aprova o envio que subiu", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    montar();
    const aprovar = await screen.findByLabelText("Aprovar");
    fireEvent.click(aprovar, { detail: 2 });
    await act(async () => {});
    expect(api.aprovarSolicitacao).not.toHaveBeenCalled();
  });

  it("⚠️ aprovado, mas a tarefa falhou: a tela diz isso e recarrega", async () => {
    vi.mocked(api.aprovarSolicitacao).mockResolvedValue({} as never);
    vi.mocked(api.criarTarefaDaSolicitacao).mockRejectedValue({ message: "quadro sem colunas" });
    montar();
    await abrirOCard();
    vi.mocked(api.listarEnvios).mockClear();
    fireEvent.click(await screen.findByText("Aprovar e criar tarefa"));
    expect(await screen.findByText(/foi aprovado, mas a tarefa não foi criada \(quadro sem colunas\)/)).toBeTruthy();
    // Recarrega: o pedido já não está pendente, e a tela precisa saber.
    await waitFor(() => expect(api.listarEnvios).toHaveBeenCalled());
  });

  it("✕ na LISTA abre o envio já pedindo a justificativa", async () => {
    montar();
    fireEvent.click(await screen.findByLabelText("Rejeitar"));
    expect(await screen.findByText("Confirmar rejeição")).toBeTruthy();
    expect(api.rejeitarSolicitacao).not.toHaveBeenCalled();
  });

  it("⚠️ envio com VÁRIAS demandas não decide na lista -- uma por uma", async () => {
    montar([item(), item({ id: "i2", batch_seq: 2, category: "arte", category_title: "Arte" })]);
    await screen.findByText("Maria do Polo");
    expect(screen.queryByLabelText("Aprovar")).toBeNull();
  });

  it("⚠️ rejeitar EXIGE justificativa -- é o que a pessoa vai receber", async () => {
    // A recusa é no clique, com mensagem, e não com botão cinza (que não diz o que falta).
    montar();
    await abrirOCard();
    fireEvent.click(await painel().findByText("Rejeitar"));
    fireEvent.click(await screen.findByText("Confirmar rejeição"));

    expect(await screen.findByText(/exige uma justificativa/i)).toBeTruthy();
    expect(api.rejeitarSolicitacao).not.toHaveBeenCalled();
  });

  it("com justificativa, rejeitar vai -- e leva o texto aparado", async () => {
    vi.mocked(api.rejeitarSolicitacao).mockResolvedValue({} as never);
    montar();
    await abrirOCard();
    fireEvent.click(await painel().findByText("Rejeitar"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  fora do escopo  " },
    });
    fireEvent.click(screen.getByText("Confirmar rejeição"));

    await waitFor(() =>
      expect(api.rejeitarSolicitacao).toHaveBeenCalledWith("i1", "fora do escopo")
    );
  });
});

// A tela ESPERA o time ativo antes de buscar (buscar antes mostraria a fila da
// organização inteira por um instante). O risco é esperar PARA SEMPRE: o
// `AppShell` engole a falha de `listTeamsAll()`, então "a barra ainda não
// resolveu" (`null`) tem de ser distinto de "resolveu e não há time" (`none`).
describe("a fila recorta pelo time, e não espera para sempre", () => {
  function comContexto(active: ActiveTeamContext["active"]) {
    vi.mocked(api.listarEnvios).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 10,
      pending_total: 0,
      approved_without_task_total: 0,
    });
    contextoDoTeste = { active, search: "", teamName: null, teams: [] };
    render(<SolicitacoesPage />);
  }

  afterEach(() => {
    // Devolve o padrão: sem isto o último valor vazaria para os outros testes.
    contextoDoTeste = {
      active: { kind: "team", teamId: "team-da-fila", fromUrl: true },
      search: "?time=team-da-fila",
      teamName: "Marketing",
        teams: [],
      };
  });

  it("manda o time ativo no `listarEnvios`", async () => {
    comContexto({ kind: "team", teamId: "t-mkt", fromUrl: true });
    await waitFor(() => {
      expect(api.listarEnvios).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "t-mkt" }),
      );
    });
  });

  it("⚠️ `kind: \"none\"` BUSCA SEM RECORTE, e não fica carregando", async () => {
    // A barra resolveu e não há time (sem vínculo, ou a árvore não chegou e o
    // erro foi engolido). A resposta certa é a fila da organização, e não uma tela parada.
    comContexto({ kind: "none" });
    await waitFor(() => {
      expect(api.listarEnvios).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: null }),
      );
    });
  });

  it("⚠️ com a barra AINDA sem resposta (`null`), não busca nada", async () => {
    // A outra metade: buscar aqui é o pisca que a espera existe para evitar.
    comContexto(null);
    await waitFor(() => {
      expect(api.listarEnvios).not.toHaveBeenCalled();
    });
  });
});
