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

function montar(form: FormularioDetalhado = formulario()) {
  vi.mocked(api.obterFormulario).mockResolvedValue(form);
  render(<EditorPage />);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

    const aviso = vi.mocked(window.alert).mock.calls[0][0] as string;
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
    fireEvent.click((await screen.findAllByText("Editar"))[0]);
    expect(screen.getByText(/não muda/i)).toBeTruthy();
    expect(screen.queryByLabelText("Endereço interno")).toBeNull();
  });

  it("excluir avisa que os pedidos que já chegaram NÃO são apagados", async () => {
    vi.mocked(api.apagarSecao).mockResolvedValue(undefined);
    montar();
    fireEvent.click((await screen.findAllByText("Excluir"))[0]);
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
    expect(voltar.getAttribute("href")).toBe("/formularios");
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
