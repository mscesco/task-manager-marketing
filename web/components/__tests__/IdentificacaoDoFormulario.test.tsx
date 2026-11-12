// A etapa de IDENTIFICAÇÃO do formulário público, montada de verdade. Prende o
// que o backend não consegue prender sozinho: o campo desligado some da tela,
// deixa de ser exigido, e o envio manda `null` ("não perguntou"), e não `""`
// ("perguntou e ficou em branco").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FormularioSolicitacao, {
  type CamposDeIdentificacao,
} from "@/components/FormularioSolicitacao";
import type { Categoria } from "@/lib/solicitacaoForm";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, enviarSolicitacaoPublica: vi.fn() };
});

const api = await import("@/lib/api");

const CATEGORIA: Categoria = {
  slug: "acesso",
  titulo: "Pedido de acesso",
  emoji: "🔑",
  prazo: null,
  resumoDe: "sistema",
  campos: [
    { id: "sistema", label: "Qual sistema?", tipo: "texto", obrigatorio: true },
  ],
};

const TUDO: CamposDeIdentificacao = {
  telefone: "Telefone",
  area: "Área / Departamento",
  polo: "Polo",
};

function montar(identificacao: CamposDeIdentificacao = TUDO) {
  render(
    <FormularioSolicitacao
      categorias={[CATEGORIA]}
      categoriaPorSlug={{ acesso: CATEGORIA }}
      formId="f1"
      titulo="Pedido de acesso — TI"
      descricao="Diga o que você precisa."
      identificacao={identificacao}
    />
  );
}

/**
 * Preenche a etapa 0 e avança até a revisão, respondendo a única pergunta.
 *
 * Seletores em regex: o rótulo carrega o marcador de obrigatório, então o nome
 * acessível é "Nome *". O botão de envio vai por texto exato: `/Enviar/i` casa
 * também com "Enviar outra solicitação", da tela de sucesso.
 */
function preencher(comOpcionais: string[]) {
  fireEvent.change(screen.getByLabelText(/^Nome/), {
    target: { value: "Maria do Polo" },
  });
  fireEvent.change(screen.getByLabelText(/^E-mail/), {
    target: { value: "maria@polo.ex" },
  });
  for (const rotulo of comOpcionais) {
    fireEvent.change(screen.getByLabelText(new RegExp("^" + rotulo)), {
      target: { value: rotulo === "Telefone" ? "11999990000" : "Sede" },
    });
  }
  fireEvent.click(screen.getByText("Pedido de acesso"));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("o rascunho local", () => {
  // A chave é por formulário: `selecionadas` guarda slug de seção, e restaurar
  // o rascunho de outro formulário deixaria a tela em branco.
  const CHAVE_ANTIGA = "fazae:rascunho-solicitacao:v1";

  function gravar(chave: string, dados: object) {
    window.localStorage.setItem(
      chave,
      JSON.stringify({ salvoEm: Date.now(), ...dados })
    );
  }

  it("⚠️ rascunho de OUTRO formulário não é oferecido", () => {
    gravar("fazae:rascunho-solicitacao:v2:f-OUTRO", {
      ident: { nome: "Maria" },
      selecionadas: ["arte"],
      valores: {},
      passo: 2,
    });
    montar();
    // O banner de "continuar" não aparece: a gaveta é por formulário.
    expect(screen.queryByText(/Continuar de onde parei/i)).toBeNull();
  });

  it("⚠️ a chave ANTIGA e global é APAGADA, e não é oferecida", () => {
    // Ela não sabe de qual formulário veio, então não dá para migrá-la; e só a
    // leitura avalia a expiração, então ignorada ficaria no navegador para sempre.
    gravar(CHAVE_ANTIGA, {
      ident: { nome: "Maria" },
      selecionadas: ["arte"],
      valores: {},
      passo: 2,
    });
    montar();
    expect(window.localStorage.getItem(CHAVE_ANTIGA)).toBeNull();
    expect(screen.queryByText(/Continuar de onde parei/i)).toBeNull();
  });

  it("o rascunho DESTE formulário continua sendo oferecido", async () => {
    gravar("fazae:rascunho-solicitacao:v2:f1", {
      ident: { nome: "Maria" },
      selecionadas: ["acesso"],
      valores: {},
      passo: 1,
    });
    montar();
    expect(await screen.findByText(/Continuar de onde parei/i)).toBeTruthy();
  });

  it("⚠️ seção APAGADA no editor não deixa a tela em branco", async () => {
    // A chave por formulário não cobre isto: a seção pode ter sido apagada no
    // editor entre a visita e o retorno. O `passo` volta a zero e a pessoa é avisada.
    gravar("fazae:rascunho-solicitacao:v2:f1", {
      ident: { nome: "Maria" },
      selecionadas: ["acesso", "secao-apagada"],
      valores: {},
      passo: 2,
    });
    montar();
    fireEvent.click(await screen.findByText(/Continuar de onde parei/i));

    // A etapa 0 volta a existir -- a tela NÃO fica em branco.
    expect(await screen.findByLabelText(/^Nome/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/não existe mais/i);
  });
});

describe("a etapa de identificação, montada de verdade", () => {
  it("⚠️ o campo DESLIGADO some da tela", async () => {
    montar({ telefone: "Telefone", area: null, polo: null });
    expect(await screen.findByLabelText(/^Nome/)).toBeTruthy();
    expect(screen.getByLabelText(/^Telefone/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Polo/)).toBeNull();
    expect(screen.queryByLabelText(/^Área/)).toBeNull();

    // A contagem é o que morde: um campo de rótulo vazio continuaria na tela, e
    // os `queryByLabelText` acima não o achariam (label vazio não casa com nada).
    expect(document.querySelectorAll('input[id^="id-"]')).toHaveLength(3);
  });

  it("⚠️ e DEIXA DE SER EXIGIDO -- senão o avançar trava sem explicação", async () => {
    montar({ telefone: null, area: null, polo: null });
    preencher([]);
    const avancar = (await screen.findByText(/Continuar|Avançar|Próximo/i))
      .closest("button")!;
    expect(avancar.disabled).toBe(false);
  });

  it("⚠️ o que o formulário NÃO pergunta vai como `null`, e não como \"\"", async () => {
    vi.mocked(api.enviarSolicitacaoPublica).mockResolvedValue({
      protocol: "ABC123",
      created: 1,
    });
    montar({ telefone: "Telefone", area: null, polo: null });
    preencher(["Telefone"]);
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo/i));

    fireEvent.change(await screen.findByLabelText(/Qual sistema/), {
      target: { value: "o CRM" },
    });
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo|Revisar/i));
    fireEvent.click(await screen.findByText("Enviar solicitação"));

    const corpo = vi.mocked(api.enviarSolicitacaoPublica).mock.calls[0][0];
    expect(corpo.requester_phone).toBe("11999990000");
    expect(corpo.requester_department).toBeNull();
    expect(corpo.requester_polo).toBeNull();
  });

  it("⚠️ a mensagem de erro NÃO cobra campo que a tela não desenha", async () => {
    montar({ telefone: "WhatsApp", area: null, polo: null });
    fireEvent.change(await screen.findByLabelText(/^Nome/), {
      target: { value: "Maria" },
    });
    fireEvent.change(screen.getByLabelText(/^E-mail/), {
      target: { value: "maria@polo.ex" },
    });
    fireEvent.click(screen.getByText("Pedido de acesso"));
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo/i));

    const erro = await screen.findByRole("alert");
    expect(erro.textContent).toContain("whatsapp");
    expect(erro.textContent).not.toMatch(/polo/i);
    expect(erro.textContent).not.toMatch(/área/i);
  });

  it("⚠️ a revisão não deixa separador pendurado sem telefone", async () => {
    vi.mocked(api.enviarSolicitacaoPublica).mockResolvedValue({
      protocol: "ABC123",
      created: 1,
    });
    montar({ telefone: null, area: null, polo: null });
    preencher([]);
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo/i));
    fireEvent.change(await screen.findByLabelText(/Qual sistema/), {
      target: { value: "o CRM" },
    });
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo|Revisar/i));

    await screen.findByText("Enviar solicitação");
    expect(document.body.textContent).not.toMatch(/maria@polo\.ex\s*·\s*$/m);
    expect(document.body.textContent).not.toContain("· ·");
  });

  it("⚠️ o TÍTULO vem do banco, e não de um texto fixo", async () => {
    montar();
    expect(await screen.findByText("Pedido de acesso — TI")).toBeTruthy();
    expect(screen.queryByText(/FazAê/)).toBeNull();
  });

  it("a descrição do formulário substitui o texto genérico", async () => {
    montar();
    expect(await screen.findByText("Diga o que você precisa.")).toBeTruthy();
  });
});

describe("depois de enviar", () => {
  it("⚠️ enviado, o foco vai para o título", async () => {
    // O envio troca a tela inteira e o botão que tinha o foco some. Sem mover
    // o foco, quem usa leitor de tela aperta Enviar e não ouve nada.
    vi.mocked(api.enviarSolicitacaoPublica).mockResolvedValue({
      protocol: "ABC123",
      created: 1,
    });
    montar({ telefone: null, area: null, polo: null });
    preencher([]);
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo/i));
    fireEvent.change(await screen.findByLabelText(/Qual sistema/), {
      target: { value: "o CRM" },
    });
    fireEvent.click(screen.getByText(/Continuar|Avançar|Próximo|Revisar/i));
    fireEvent.click(await screen.findByText("Enviar solicitação"));

    const titulo = await screen.findByRole("heading", {
      level: 1,
      name: "Solicitação enviada",
    });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    // O texto não fala mais de um time fixo: o formulário pode ser de qualquer um.
    expect(screen.queryByText(/time de marketing/i)).toBeNull();
  });
});
