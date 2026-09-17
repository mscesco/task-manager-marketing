// A tela do editor de formulário (Spec 043, fatia C2).
//
// ⚠️ ELA NASCEU DE UMA PERGUNTA DE UMA LINHA: "consigo criar mas onde eu
// edito? kkk" (Camila, 26/08). A fatia C1 entregou a lista, e o primeiro
// formulário criado por ela bateu num beco -- "um formulário sem perguntas não
// pode ser publicado", e nenhum lugar onde pôr perguntas.
//
// ⚠️⚠️ E O TESTE MAIS IMPORTANTE AQUI É O DO `options`, porque ele é o hop que
// eu já deixei aberto uma vez nesta mesma spec. Ao ligar o `form_id` no envio
// público (fatia B), tirei a linha do componente para conferir se algum teste
// caía: **nenhum caiu**. Os nove testes provavam que o dado chegava ao
// componente, e nenhum provava que ele entrava no CORPO. São hops diferentes.
// Aqui o corpo é assertado direto.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import EditorPage from "@/app/formularios/[id]/page";
import type { FormularioDetalhado, PerguntaDoEditor } from "@/lib/api";

// ⚠️ Os avisos saíram de `window.alert` para a pilha do app (17/09). O teste
// espia o `useAvisar` em vez de montar o `AvisosProvider`.
const avisar = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toasts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/Toasts")>()),
  useAvisar: () => avisar,
}));

vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "f1" }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    obterFormulario: vi.fn(),
    criarSecao: vi.fn(),
    editarSecao: vi.fn(),
    apagarSecao: vi.fn(),
    definirResumo: vi.fn(),
    criarPergunta: vi.fn(),
    editarPergunta: vi.fn(),
    definirCondicional: vi.fn(),
    apagarPergunta: vi.fn(),
    reordenarSecoes: vi.fn(),
    reordenarPerguntas: vi.fn(),
    publicarFormulario: vi.fn(),
    renomearFormulario: vi.fn(),
  };
});

const api = await import("@/lib/api");

function pergunta(over: Partial<PerguntaDoEditor> = {}): PerguntaDoEditor {
  return {
    id: "q",
    section_id: "s1",
    label: "Pergunta",
    kind: "texto",
    required: false,
    options: [],
    placeholder: null,
    help: null,
    show_if_question_id: null,
    show_if_value: null,
    position: 0,
    ...over,
  };
}

const ALVO = pergunta({
  id: "alvo",
  label: "O que você precisa?",
  kind: "escolha",
  options: ["Sessão de fotos", "Edição de fotos"],
  position: 0,
});
// ⚠️ ESTA PERGUNTA DE TEXTO EXISTE PARA O TESTE DO SELECT, e a razão de estar
// aqui é uma sabotagem que passou verde: com só o ALVO antes da DEP, tirar o
// filtro de tipo não mudava a lista oferecida, porque o único candidato já era
// de escolha. A fixture concordava com o código por acaso -- foi o mesmo erro
// da Spec 039 (sabotagem D), em que a ordem do array já batia com a esperada.
const MEIO = pergunta({ id: "meio", label: "Observação", kind: "texto", position: 1 });

const DEP = pergunta({
  id: "dep",
  label: "Data da sessão",
  kind: "data",
  position: 2,
  show_if_question_id: "alvo",
  show_if_value: "Sessão de fotos",
});

function formulario(over: Partial<FormularioDetalhado> = {}): FormularioDetalhado {
  return {
    id: "f1",
    team_id: "t1",
    slug: "marketing",
    title: "Solicitação ao Marketing",
    description: "",
    is_published: false,
    phone_label: "Telefone",
    department_label: "Área / Departamento",
    polo_label: "Polo",
    sections: [
      {
        id: "s1",
        slug: "foto",
        title: "Foto",
        emoji: "📷",
        sla_text: null,
        summary_question_id: null,
        position: 0,
        questions: [ALVO, MEIO, DEP],
      },
    ],
    ...over,
  };
}

/**
 * ⚠️ A VERSÃO APERTADA: gatilho e dependente COLADOS, sem nada entre eles.
 *
 * Ela existe porque as duas fixtures medem coisas opostas e uma não serve para
 * a outra. Com `Observação` no meio, mover uma casa **não** quebra a
 * condicional -- `alvo` continua antes de `dep` --, e o botão fica
 * legitimamente clicável. Só coladas é que um passo já inverte os dois.
 *
 * Escrevi os testes das setas contra a fixture larga e eles passaram; passaram
 * porque a distância entre as duas perguntas era acidental, e não porque a
 * guarda funcionava.
 */
function formularioApertado(): FormularioDetalhado {
  return formulario({
    sections: [
      {
        id: "s1",
        slug: "foto",
        title: "Foto",
        emoji: "📷",
        sla_text: null,
        summary_question_id: null,
        position: 0,
        questions: [ALVO, { ...DEP, position: 1 }],
      },
    ],
  });
}

/**
 * ⚠️ `getAllByText("Editar")[0]` ERA FRÁGIL E QUEBROU. O painel do cabeçalho
 * (fatia G) nasceu acima das seções e roubou o índice 0 -- o teste da seção
 * passou a clicar no cabeçalho. Cada um passa a ser aberto pelo seu próprio
 * ancoradouro, e não por posição.
 */
async function abrirCabecalho() {
  const linha = (await screen.findByText("Cabeçalho")).closest("div")!;
  fireEvent.click(within_(linha, "Editar"));
}

async function abrirSecao(titulo = "Foto") {
  const linha = (await screen.findByText(titulo)).closest("header")!;
  fireEvent.click(within_(linha, "Editar"));
}

function montar(form: FormularioDetalhado = formulario()) {
  vi.mocked(api.obterFormulario).mockResolvedValue(form);
  render(<EditorPage />);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// =====================================================================
// ⚠️ O cabeçalho (Spec 043, fatia G)
// =====================================================================
describe("o cabeçalho do formulário", () => {
  it("⚠️ NOME e E-MAIL aparecem como sempre pedidos, e explicados", async () => {
    // ⚠️ SEM ISSO, quem procura "por que não consigo tirar o e-mail?" não acha
    // resposta em lugar nenhum. Eles não são configuráveis porque a fila é
    // organizada por quem pediu e a resposta automática precisa do endereço.
    montar();
    await abrirCabecalho();
    expect(screen.getByText(/são sempre pedidos/i)).toBeTruthy();
  });

  it("desmarcar um campo apaga o rótulo e avisa que ele some", async () => {
    montar();
    await abrirCabecalho();
    const caixas = screen.getAllByRole("checkbox");
    fireEvent.click(caixas[2]); // Polo
    expect(await screen.findByText("não aparece no formulário")).toBeTruthy();
  });

  it("⚠️ salvar manda os TRÊS rótulos, com `null` no que foi desligado", async () => {
    // ⚠️ AQUI `null` SIGNIFICA "DESLIGUE", e não "não mexa" -- o oposto dos
    // outros campos do PATCH. O backend distingue "não veio" de "veio null"
    // pelo corpo, e este painel é exatamente onde a intenção é decidida, então
    // os três vão sempre.
    vi.mocked(api.renomearFormulario).mockResolvedValue({} as never);
    montar();
    await abrirCabecalho();
    fireEvent.click(screen.getAllByRole("checkbox")[2]); // desliga Polo
    fireEvent.change(screen.getByLabelText("Nome do campo Telefone"), {
      target: { value: "WhatsApp" },
    });
    fireEvent.click(screen.getByText("Salvar cabeçalho"));

    await waitFor(() => expect(api.renomearFormulario).toHaveBeenCalled());
    const corpo = vi.mocked(api.renomearFormulario).mock.calls[0][1];
    expect(corpo.phone_label).toBe("WhatsApp");
    expect(corpo.department_label).toBe("Área / Departamento");
    expect(corpo.polo_label).toBeNull();
  });

  it("o título vai junto -- é ele que aparece no topo da página pública", async () => {
    vi.mocked(api.renomearFormulario).mockResolvedValue({} as never);
    montar();
    await abrirCabecalho();
    fireEvent.change(
      screen.getByLabelText(/Título — é o que aparece no topo/),
      { target: { value: "Pedido de acesso — TI" } }
    );
    fireEvent.click(screen.getByText("Salvar cabeçalho"));

    await waitFor(() =>
      expect(
        vi.mocked(api.renomearFormulario).mock.calls[0][1].title
      ).toBe("Pedido de acesso — TI")
    );
  });

  it("⚠️ CANCELAR desfaz -- o resumo não pode mentir sobre o banco", async () => {
    // ⚠️⚠️ ACHADO PELA REVISÃO DE 31/08, e é o de consequência mais silenciosa
    // dos quatro. `Cancelar` só fechava o painel; o estado local guardava a
    // mudança descartada, e o resumo fechado lia esse estado. Resultado:
    // a tela dizia "não pede mais Polo" com o banco pedindo -- e a porta
    // pública continuava perguntando.
    montar();
    await abrirCabecalho();
    fireEvent.click(screen.getAllByRole("checkbox")[2]); // desliga Polo
    fireEvent.click(screen.getByText("Cancelar"));

    expect(await screen.findByText(/pede Nome, E-mail, Telefone/)).toBeTruthy();
    expect(screen.getByText(/Polo/)).toBeTruthy();
  });

  it("⚠️ e reabrir depois do Cancelar não reenvia o que foi descartado", async () => {
    // ⚠️ O SEGUNDO ESTRAGO DO MESMO DEFEITO, e o pior: semanas depois alguém
    // reabre para corrigir uma vírgula no título e clica Salvar. O painel
    // manda os três rótulos sempre (é onde a intenção é decidida), então o
    // `polo_label: null` esquecido ia junto -- e o backend, por contrato,
    // trata `null` como DESLIGUE. O rótulo sumia sem ninguém pedir.
    vi.mocked(api.renomearFormulario).mockResolvedValue({} as never);
    montar();
    await abrirCabecalho();
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    fireEvent.click(screen.getByText("Cancelar"));

    await abrirCabecalho();
    fireEvent.change(
      screen.getByLabelText(/Título — é o que aparece no topo/),
      { target: { value: "Só corrigindo o título" } }
    );
    fireEvent.click(screen.getByText("Salvar cabeçalho"));

    await waitFor(() => expect(api.renomearFormulario).toHaveBeenCalled());
    const corpo = vi.mocked(api.renomearFormulario).mock.calls[0][1];
    expect(corpo.title).toBe("Só corrigindo o título");
    expect(corpo.polo_label).toBe("Polo");
  });

  it("fechado, o resumo diz o que o formulário pede hoje", async () => {
    montar();
    expect(
      await screen.findByText(/pede Nome, E-mail, Telefone/)
    ).toBeTruthy();
  });
});

// =====================================================================
// ⚠️ O corpo que realmente sai
// =====================================================================
describe("o corpo que sai nas escritas", () => {
  it("⚠️ criar pergunta de ESCOLHA leva as alternativas quebradas por linha", async () => {
    vi.mocked(api.criarPergunta).mockResolvedValue(pergunta({ id: "novo" }));
    montar();

    fireEvent.click(await screen.findByText("+ Nova pergunta"));
    fireEvent.change(screen.getByLabelText("Pergunta"), {
      target: { value: "Formato" },
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "escolha" },
    });
    fireEvent.change(screen.getByLabelText("Alternativas — uma por linha"), {
      target: { value: "A4\n  A3  \n\nA2" },
    });
    fireEvent.click(screen.getByText("Criar pergunta"));

    await waitFor(() =>
      expect(api.criarPergunta).toHaveBeenCalledWith("s1", {
        label: "Formato",
        kind: "escolha",
        required: false,
        // ⚠️ APARADAS E SEM LINHA VAZIA. Uma alternativa em branco vira uma
        // opção invisível no formulário público -- dá para escolher e não dá
        // para ler.
        options: ["A4", "A3", "A2"],
      })
    );
  });

  it("⚠️ editar SEM mexer no tipo NÃO manda `options` -- omitir é 'não mexa'", async () => {
    // ⚠️ ESTE É O TESTE QUE A FATIA B NÃO TINHA. Mandar `options: []` num
    // `texto` é inofensivo; o perigo é o contrário -- se o campo viesse sempre,
    // o backend não teria como distinguir "esvazie" de "não mexa", e quem só
    // corrigiu uma vírgula no título perderia a lista inteira.
    vi.mocked(api.editarPergunta).mockResolvedValue(DEP);
    montar();

    const linha = (await screen.findByText("Data da sessão")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));
    fireEvent.change(screen.getByLabelText("Pergunta"), {
      target: { value: "Data da sessão de fotos" },
    });
    fireEvent.click(screen.getByText("Salvar pergunta"));

    await waitFor(() => expect(api.editarPergunta).toHaveBeenCalled());
    const corpo = vi.mocked(api.editarPergunta).mock.calls[0][1];
    expect(corpo.label).toBe("Data da sessão de fotos");
    expect(corpo).not.toHaveProperty("options");
  });

  it("⚠️ a condicional vai em chamada SEPARADA, e só quando muda", async () => {
    // Ela é rota própria porque `null` ali significa DESLIGAR, e num PATCH
    // significaria "não mexa". Disparar a chamada sem mudança nenhuma seria
    // reescrever a condicional a cada salvamento -- barato, mas é escrita à
    // toa num campo que quebra pergunta.
    vi.mocked(api.editarPergunta).mockResolvedValue(DEP);
    montar();

    const linha = (await screen.findByText("Data da sessão")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));
    fireEvent.change(screen.getByLabelText("Pergunta"), {
      target: { value: "Quando?" },
    });
    fireEvent.click(screen.getByText("Salvar pergunta"));

    await waitFor(() => expect(api.editarPergunta).toHaveBeenCalled());
    expect(api.definirCondicional).not.toHaveBeenCalled();
  });

  it("⚠️ reordenar manda o CONJUNTO INTEIRO, na ordem nova", async () => {
    // ⚠️ O backend recusa lista parcial: aceitá-la deixaria uma aba velha,
    // aberta desde antes de alguém criar uma pergunta, sobrescrever a ordem
    // com um mundo que não existe mais. Por isso a asserção é sobre os TRÊS
    // ids, e não só sobre os dois que trocaram.
    vi.mocked(api.reordenarPerguntas).mockResolvedValue([MEIO, ALVO, DEP]);
    montar();

    fireEvent.click(
      await screen.findByLabelText("Descer a pergunta O que você precisa?")
    );

    await waitFor(() =>
      expect(api.reordenarPerguntas).toHaveBeenCalledWith("s1", [
        "meio",
        "alvo",
        "dep",
      ])
    );
  });

  it("descer o gatilho é PERMITIDO enquanto ele continuar antes da dependente", async () => {
    // ⚠️ A GUARDA NÃO PODE SER "esta pergunta comanda alguém, então congela".
    // Com `Observação` no meio, `alvo` desce uma casa e ainda vem antes de
    // `dep` -- e proibir isso seria travar movimento legítimo por precaução.
    montar();
    const descer = await screen.findByLabelText(
      "Descer a pergunta O que você precisa?"
    );
    expect((descer as HTMLButtonElement).disabled).toBe(false);
  });
});

// =====================================================================
// ⚠️ A pergunta que some sem sumir
// =====================================================================
describe("as guardas da condicional", () => {
  it("⚠️ excluir o GATILHO avisa quem some junto, e NÃO chama a API", async () => {
    montar();
    const linha = (await screen.findByText("O que você precisa?")).closest("div")!;
    fireEvent.click(within_(linha, "Excluir"));

    const aviso = avisar.mock.calls[0][0] as string;
    expect(aviso).toContain("Data da sessão");
    expect(api.apagarPergunta).not.toHaveBeenCalled();
  });

  it("excluir uma pergunta livre pede confirmação e vai", async () => {
    vi.mocked(api.apagarPergunta).mockResolvedValue(undefined);
    montar();
    const linha = (await screen.findByText("Data da sessão")).closest("div")!;
    fireEvent.click(within_(linha, "Excluir"));

    await waitFor(() => expect(api.apagarPergunta).toHaveBeenCalledWith("dep"));
  });

  it("⚠️ as setas que quebrariam a condicional ficam cinzas COM O MOTIVO", async () => {
    // Um botão cinza sem explicação é a pior versão de uma regra: ela existe,
    // ela impede, e ninguém sabe por quê. Na fixture APERTADA, um passo já
    // inverte gatilho e dependente.
    montar(formularioApertado());
    const subir = await screen.findByLabelText("Subir a pergunta Data da sessão");
    expect((subir as HTMLButtonElement).disabled).toBe(true);
    expect(subir.getAttribute("title")).toContain("Data da sessão");
  });

  it("⚠️ e a seta do GATILHO também -- é o mesmo defeito pela outra mão", async () => {
    // Descer o gatilho para baixo da dependente dá no mesmo que subir a
    // dependente. É fácil prender um lado e esquecer o outro.
    montar(formularioApertado());
    const descer = await screen.findByLabelText(
      "Descer a pergunta O que você precisa?"
    );
    expect((descer as HTMLButtonElement).disabled).toBe(true);
    expect(descer.getAttribute("title")).toContain("Data da sessão");
  });

  it("⚠️ o select de gatilho só oferece ESCOLHA que vem ANTES", async () => {
    montar();
    const linha = (await screen.findByText("Data da sessão")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));

    const select = screen.getByLabelText("Pergunta que comanda") as HTMLSelectElement;
    const opcoes = [...select.options].map((o) => o.textContent);
    // ⚠️ "Observação" está ANTES da dependente e MESMO ASSIM não aparece --
    // ela é de texto, e comparar `igual` contra texto livre não funciona.
    expect(opcoes).toEqual(["Sempre aparece", "O que você precisa?"]);
  });

  it("a primeira pergunta não ganha select nenhum, e explica por quê", async () => {
    montar();
    const linha = (await screen.findByText("O que você precisa?")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));

    expect(screen.queryByLabelText("Pergunta que comanda")).toBeNull();
    expect(screen.getByText(/pergunta de escolha/i)).toBeTruthy();
  });
});

// =====================================================================
// A seção
// =====================================================================
describe("a seção", () => {
  it("⚠️ o painel de edição avisa que o endereço NÃO muda, e por quê", async () => {
    // É o único campo da tela que não dá para mudar, e o motivo é invisível:
    // ele viaja gravado em cada pedido e é o que mantém a fila legível.
    montar();
    await abrirSecao();
    expect(screen.getByText(/não muda/i)).toBeTruthy();
    expect(screen.queryByLabelText("Endereço interno")).toBeNull();
  });

  it("excluir avisa que os pedidos que já chegaram NÃO são apagados", async () => {
    vi.mocked(api.apagarSecao).mockResolvedValue(undefined);
    montar();
    const linha = (await screen.findByText("Foto")).closest("header")!;
    fireEvent.click(within_(linha, "Excluir"));
    const texto = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(texto).toMatch(/NÃO são apagados/i);
    expect(texto).toContain("3 perguntas");
  });

  it("⚠️ o slug sugerido para de seguir o título assim que alguém mexe nele", async () => {
    // Ele é permanente. Sobrescrever o que a pessoa digitou seria trocar, sem
    // aviso, um valor que não tem volta.
    montar(formulario({ sections: [] }));
    fireEvent.click(await screen.findByText("+ Nova seção"));
    fireEvent.change(screen.getByLabelText("Título da seção"), {
      target: { value: "Criar uma arte" },
    });
    const slug = screen.getByLabelText("Endereço interno") as HTMLInputElement;
    expect(slug.value).toBe("criar-uma-arte");

    fireEvent.change(slug, { target: { value: "arte" } });
    fireEvent.change(screen.getByLabelText("Título da seção"), {
      target: { value: "Criar uma arte nova" },
    });
    expect(slug.value).toBe("arte");
  });
});

// =====================================================================
// O erro do servidor
// =====================================================================
describe("erros", () => {
  it("⚠️ a mensagem do backend aparece INTEIRA -- é ela que nomeia a pergunta", async () => {
    // "Não consegui salvar" mandaria procurar sozinha entre 108 perguntas qual
    // delas travou.
    vi.mocked(api.editarPergunta).mockRejectedValue(
      Object.assign(
        new Error(
          "Esta pergunta comanda outras (“Data da sessão”), então ela precisa continuar sendo de escolha."
        ),
        { status: 422 }
      )
    );
    montar();
    const linha = (await screen.findByText("O que você precisa?")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));
    fireEvent.click(screen.getByText("Salvar pergunta"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/comanda outras/)).toBeTruthy();
  });

  it("⚠️ um erro NÃO apaga o que a pessoa digitou (criar seção)", async () => {
    // ⚠️⚠️ ACHADO PELA REVISÃO DE 31/08. O helper `agir` engolia a exceção,
    // então `await agir(…)` sempre resolvia com sucesso -- e os quatro botões
    // de Salvar limpavam os campos e fechavam o painel MESMO com o backend
    // recusando. A pessoa via a mensagem que NOMEIA o problema e o texto que
    // ela precisava corrigir já tinha sumido.
    //
    // ⚠️ E slug repetido é a recusa mais comum aqui.
    vi.mocked(api.criarSecao).mockRejectedValue(
      Object.assign(new Error("Já existe uma seção com este endereço."), {
        status: 422,
      })
    );
    montar(formulario({ sections: [] }));
    fireEvent.click(await screen.findByText("+ Nova seção"));
    fireEvent.change(screen.getByLabelText("Título da seção"), {
      target: { value: "Solicitação de arte para a campanha" },
    });
    fireEvent.click(screen.getByText("Criar seção"));

    expect(await screen.findByText(/Já existe uma seção/)).toBeTruthy();
    // ⚠️ O PAINEL CONTINUA ABERTO E O TEXTO CONTINUA LÁ.
    expect(
      (screen.getByLabelText("Título da seção") as HTMLInputElement).value
    ).toBe("Solicitação de arte para a campanha");
  });

  it("⚠️ nem as alternativas digitadas à mão (criar pergunta)", async () => {
    vi.mocked(api.criarPergunta).mockRejectedValue(
      Object.assign(new Error("Este tipo de pergunta não existe."), {
        status: 422,
      })
    );
    montar();
    fireEvent.click(await screen.findByText("+ Nova pergunta"));
    fireEvent.change(screen.getByLabelText("Pergunta"), {
      target: { value: "Qual formato?" },
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "escolha" },
    });
    fireEvent.change(screen.getByLabelText("Alternativas — uma por linha"), {
      target: { value: "A4\nA3\nA2\nA1\nCartaz\nBanner" },
    });
    fireEvent.click(screen.getByText("Criar pergunta"));

    expect(await screen.findByText(/tipo de pergunta não existe/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Alternativas — uma por linha") as HTMLTextAreaElement)
        .value
    ).toContain("Banner");
  });

  it("⚠️ e o painel da pergunta não fecha quando o backend recusa", async () => {
    // Aqui a mensagem é a que NOMEIA a dependente ("Data da sessão") -- fechar
    // o painel deixaria a instrução sem onde ser aplicada.
    vi.mocked(api.editarPergunta).mockRejectedValue(
      Object.assign(new Error("Esta pergunta comanda outras."), { status: 422 })
    );
    montar();
    const linha = (await screen.findByText("O que você precisa?")).closest("div")!;
    fireEvent.click(within_(linha, "Editar"));
    fireEvent.click(screen.getByText("Salvar pergunta"));

    expect(await screen.findByText(/comanda outras/)).toBeTruthy();
    expect(screen.getByText("Salvar pergunta")).toBeTruthy();
  });

  it("formulário que não existe mais tem texto próprio, e não 'não consegui'", async () => {
    vi.mocked(api.obterFormulario).mockRejectedValue(
      Object.assign(new Error("x"), { status: 404 })
    );
    render(<EditorPage />);
    expect(await screen.findByText(/não existe mais/i)).toBeTruthy();
  });

  it("⚠️ o voltar existe -- ele já foi esquecido uma vez na tela de projeto", async () => {
    montar();
    const voltar = await screen.findByText("‹ Formulários");
    // ⚠️ COM O TIME DO FORMULÁRIO (14/09): o caminho puro apagava o `?time=`
    // e a lista caía na reserva. O fixture é do `t1`. (No ramo de erro, sem
    // formulário carregado, o voltar segue puro -- não há time para levar.)
    expect(voltar.getAttribute("href")).toBe("/formularios?time=t1");
  });
});

/** Acha um botão pelo texto DENTRO de um trecho -- `getByText` global pegaria
 *  o da linha vizinha, que foi exatamente um erro meu na Spec 039. */
function within_(raiz: HTMLElement, texto: string): HTMLElement {
  const alvo = [...raiz.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto
  );
  if (!alvo) throw new Error(`não achei o botão “${texto}” nesta linha`);
  return alvo;
}
