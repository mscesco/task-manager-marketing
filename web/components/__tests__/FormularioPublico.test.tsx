// A porta de entrada pública lendo do banco.
//
// ⚠️⚠️ OS DOIS TEXTOS DE ERRO: **404** é "o link não serve, fale com quem
// enviou"; **qualquer outra falha** é problema nosso, e mandar a pessoa cobrar
// quem enviou seria fazê-la incomodar alguém à toa.
//
// ⚠️ E NÃO HÁ RESERVA NO `solicitacaoForm.ts`: cair no arquivo estático
// manteria a porta de pé servindo perguntas VELHAS sem ninguém perceber.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import CarregaFormularioPublico from "@/components/CarregaFormularioPublico";
import SolicitarPage from "@/app/solicitar/page";
import type { FormularioPublico, FormularioPublicoResumo } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listarFormulariosPublicos: vi.fn(),
    obterFormularioPublico: vi.fn(),
  };
});

// ⚠️ O FORMULÁRIO DE VERDADE É DUBLADO: são ~580 linhas com passos, rascunho
// em `localStorage` e envio. Montá-lo aqui faria este arquivo falhar por
// motivos que não têm nada a ver com carregar o formulário -- e o que se está
// medindo é justamente o CARREGAMENTO.
vi.mock("@/components/FormularioSolicitacao", () => ({
  default: ({
    categorias,
    formId,
    titulo,
    identificacao,
  }: {
    categorias: { slug: string }[];
    formId: string;
    titulo: string;
    identificacao: Record<string, string | null>;
  }) => (
    <div
      data-formulario
      data-form-id={formId}
      data-titulo={titulo}
      data-ident={JSON.stringify(identificacao)}
    >
      {categorias.map((c) => c.slug).join(",")}
    </div>
  ),
}));

const api = await import("@/lib/api");

function form(over: Partial<FormularioPublico> = {}): FormularioPublico {
  return {
    id: "f1",
    slug: "marketing",
    title: "Solicitação ao Marketing",
    description: "",
    phone_label: "Telefone",
    department_label: "Área / Departamento",
    polo_label: "Polo",
    sections: [
      {
        slug: "arte",
        title: "Criar uma arte",
        emoji: "🖼️",
        sla_text: null,
        summary_question_id: null,
        questions: [
          {
            id: "q1",
            label: "O que precisa?",
            kind: "texto",
            required: true,
            options: [],
            placeholder: null,
            help: null,
            show_if_question_id: null,
            show_if_value: null,
          },
        ],
      },
    ],
    ...over,
  };
}

function resumo(
  slug: string,
  team_name: string,
  title = slug
): FormularioPublicoResumo {
  return { slug, title, description: "", team_name };
}

function erroDeApi(status: number) {
  return Object.assign(new Error("falhou"), { status });
}

/** A porta com UM formulário só -- o caminho que abre direto. */
function SolicitarPageComUmSo() {
  vi.mocked(api.listarFormulariosPublicos).mockResolvedValue([
    resumo("marketing", "Marketing"),
  ]);
  return <SolicitarPage />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// =====================================================================
// Os dois erros -- o assunto do arquivo
// =====================================================================
describe("CarregaFormularioPublico -- os dois erros são diferentes", () => {
  it("⚠️ 404 acusa o ENDEREÇO, e manda falar com quem enviou", async () => {
    vi.mocked(api.obterFormularioPublico).mockRejectedValue(erroDeApi(404));
    render(
      <CarregaFormularioPublico slug="sumiu">
        {() => <div>não deveria aparecer</div>}
      </CarregaFormularioPublico>
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    // O aviso É a página, e tem de ser o título
    // dela (quem chega por link quebrado precisa de um).
    expect(
      screen.getByRole("heading", { level: 1, name: "Este formulário não está disponível" })
    ).toBeTruthy();
    expect(screen.getByText(/não existe mais, ou o endereço está errado/i)).toBeTruthy();
    expect(screen.getByText(/Peça o link a quem enviou/i)).toBeTruthy();
  });

  it("⚠️ 500 NÃO manda conferir o link -- o link está certo, o problema é nosso", async () => {
    vi.mocked(api.obterFormularioPublico).mockRejectedValue(erroDeApi(500));
    render(
      <CarregaFormularioPublico slug="marketing">
        {() => <div>não deveria aparecer</div>}
      </CarregaFormularioPublico>
    );

    expect(await screen.findByText(/Não consegui carregar o formulário/i)).toBeTruthy();
    // ⚠️ A ASSERÇÃO QUE IMPORTA É A NEGATIVA: mandar cobrar quem enviou por uma
    // falha de servidor faria a pessoa incomodar alguém à toa.
    expect(screen.queryByText(/Peça o link a quem enviou/i)).toBeNull();
  });

  it("⚠️ NÃO cai no formulário estático quando a API falha", async () => {
    // Cair no `solicitacaoForm.ts` manteria a porta de pé servindo as
    // perguntas VELHAS -- e ninguém saberia. Falha visível.
    vi.mocked(api.obterFormularioPublico).mockRejectedValue(erroDeApi(500));
    render(
      <CarregaFormularioPublico slug="marketing">
        {() => <div data-formulario>desenhou</div>}
      </CarregaFormularioPublico>
    );
    await screen.findByRole("alert");
    expect(document.querySelector("[data-formulario]")).toBeNull();
  });

  it("publicado mas SEM perguntas tem texto próprio", async () => {
    // ⚠️ Não é erro de carregamento, e cair no texto de "endereço errado"
    // mandaria a pessoa cobrar quem enviou por algo que quem MONTOU resolve.
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(
      form({ sections: [] })
    );
    render(
      <CarregaFormularioPublico slug="marketing">
        {() => <div>x</div>}
      </CarregaFormularioPublico>
    );
    expect(await screen.findByText(/ainda não tem perguntas/i)).toBeTruthy();
  });

  it("⚠️ o `formId` chega ao formulário -- é ele que escolhe a FILA", async () => {
    // ⚠️ SEM ELE A SOLICITAÇÃO NASCE ÓRFÃ: continua na fila (o `JOIN` é
    // `LEFT`), mas visível a quem tem `solicitation.review` no workspace
    // inteiro, em vez do time dono do formulário -- e sem erro nenhum.
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(form());
    render(<SolicitarPageComUmSo />);
    await waitFor(() =>
      expect(
        document.querySelector("[data-formulario]")?.getAttribute("data-form-id")
      ).toBe("f1")
    );
  });

  it("⚠️ o TÍTULO do banco chega ao formulário", async () => {
    // ⚠️ Título fixo no componente faria todo formulário novo abrir com o
    // nome do Marketing.
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(
      form({ title: "Pedido de acesso — TI" })
    );
    render(<SolicitarPageComUmSo />);
    await waitFor(() =>
      expect(
        document.querySelector("[data-formulario]")?.getAttribute("data-titulo")
      ).toBe("Pedido de acesso — TI")
    );
  });

  it("⚠️ os rótulos da identificação chegam, inclusive os DESLIGADOS", async () => {
    // ⚠️ `null` = o formulário NÃO pergunta este campo. "Polo" não significa
    // nada num formulário de TI.
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(
      form({ polo_label: null, phone_label: "WhatsApp" })
    );
    render(<SolicitarPageComUmSo />);
    await waitFor(() => {
      const bruto = document
        .querySelector("[data-formulario]")
        ?.getAttribute("data-ident");
      expect(JSON.parse(bruto ?? "{}")).toEqual({
        telefone: "WhatsApp",
        area: "Área / Departamento",
        polo: null,
      });
    });
  });

  it("com formulário, entrega as categorias a quem desenha", async () => {
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(form());
    render(
      <CarregaFormularioPublico slug="marketing">
        {({ categorias }) => <div>{categorias.map((c) => c.slug).join(",")}</div>}
      </CarregaFormularioPublico>
    );
    expect(await screen.findByText("arte")).toBeTruthy();
  });
});

// =====================================================================
// A porta: lista ou formulário
// =====================================================================
describe("/solicitar -- a porta de entrada", () => {
  it("⚠️ com UM formulário, abre direto -- sem lista de um item só", async () => {
    // ⚠️ O LINK `/solicitar` JÁ ESTÁ DIVULGADO e hoje leva ao formulário.
    // Transformá-lo numa lista de um item acrescentaria um clique para todo
    // mundo que já o usa, sem dar nada em troca.
    vi.mocked(api.listarFormulariosPublicos).mockResolvedValue([
      resumo("marketing", "Marketing"),
    ]);
    vi.mocked(api.obterFormularioPublico).mockResolvedValue(form());
    render(<SolicitarPage />);

    await waitFor(() =>
      expect(document.querySelector("[data-formulario]")).toBeTruthy()
    );
    expect(screen.queryByText("O que você precisa?")).toBeNull();
  });

  it("com DOIS, mostra a lista agrupada por time", async () => {
    vi.mocked(api.listarFormulariosPublicos).mockResolvedValue([
      resumo("arte", "Marketing", "Pedidos de arte"),
      resumo("acesso", "TI", "Pedido de acesso"),
    ]);
    render(<SolicitarPage />);

    expect(await screen.findByText("O que você precisa?")).toBeTruthy();
    expect(screen.getByText("Marketing")).toBeTruthy();
    expect(screen.getByText("TI")).toBeTruthy();
    expect(
      screen.getByText("Pedidos de arte").closest("a")?.getAttribute("href")
    ).toBe("/solicitar/arte");
  });

  it("⚠️ lista VAZIA não é erro, e tem texto próprio", async () => {
    // Workspace que ainda não publicou nada. O texto de falha mandaria a
    // pessoa esperar por algo que não vai aparecer sozinho.
    vi.mocked(api.listarFormulariosPublicos).mockResolvedValue([]);
    render(<SolicitarPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Nenhum formulário disponível" })
    ).toBeTruthy();
    expect(screen.queryByText(/Não consegui carregar/i)).toBeNull();
  });

  it("falha ao listar mostra o erro de indisponibilidade", async () => {
    vi.mocked(api.listarFormulariosPublicos).mockRejectedValue(erroDeApi(500));
    render(<SolicitarPage />);

    expect(
      await screen.findByText(/Não consegui carregar os formulários/i)
    ).toBeTruthy();
  });
});
