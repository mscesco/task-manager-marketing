// A etapa de IDENTIFICAÇÃO do formulário público (Spec 043, fatia G).
//
// ⚠️⚠️ **`FormularioSolicitacao` NÃO TINHA TESTE NENHUM** — são ~580 linhas na
// única rota pública do produto, e os testes de `/solicitar` que existem
// **dublam** o componente para medir o carregamento. Descobri a lacuna
// sabotando o filtro de campos: nada caiu, porque nada monta o formulário de
// verdade.
//
// Este arquivo não cobre as 580 linhas; cobre a etapa 0 — que é a que a
// fatia G mexeu — e prende as três coisas que o backend não consegue prender
// sozinho:
//
//   - o campo desligado **some da tela**;
//   - ele **deixa de ser exigido** (senão o avançar trava num campo que não
//     existe, e quem preenche não tem como descobrir por quê);
//   - o envio manda **`null`**, e não `""` — o backend trata `null` como
//     "este formulário não perguntou" e `""` como "perguntou e ficou em
//     branco".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import FormularioSolicitacao, {
  camposDeIdentificacao,
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
 * ⚠️ OS SELETORES SÃO REGEX PORQUE O RÓTULO CARREGA O MARCADOR DE OBRIGATÓRIO
 * (`{c.label} <Obrigatorio />`), então o nome acessível é "Nome *" e não
 * "Nome". Escrevi com texto exato primeiro e três testes caíram.
 *
 * ⚠️ E O BOTÃO DE ENVIO É BUSCADO PELO TEXTO EXATO: `/Enviar/i` casava também
 * com "Enviar outra solicitação", da tela de sucesso.
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

describe("camposDeIdentificacao", () => {
  it("⚠️ NOME e E-MAIL vêm sempre, e vêm primeiro", () => {
    // Eles não são configuráveis: a fila é organizada por quem pediu, e a
    // resposta automática de mudança de status precisa do endereço.
    const campos = camposDeIdentificacao({
      telefone: null,
      area: null,
      polo: null,
    });
    expect(campos.map((c) => c.id)).toEqual(["nome", "email"]);
  });

  it("o rótulo renomeado é o que aparece", () => {
    const campos = camposDeIdentificacao({
      telefone: "WhatsApp",
      area: null,
      polo: "Unidade",
    });
    expect(campos.map((c) => c.label)).toEqual([
      "Nome",
      "E-mail",
      "WhatsApp",
      "Unidade",
    ]);
  });
});

describe("a etapa de identificação, montada de verdade", () => {
  it("⚠️ o campo DESLIGADO some da tela", async () => {
    // "Polo" é vocabulário da FECAF e não significa nada num formulário de TI.
    montar({ telefone: "Telefone", area: null, polo: null });
    expect(await screen.findByLabelText(/^Nome/)).toBeTruthy();
    expect(screen.getByLabelText(/^Telefone/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Polo/)).toBeNull();
    expect(screen.queryByLabelText(/^Área/)).toBeNull();

    // ⚠️⚠️ A CONTAGEM É A ASSERÇÃO QUE MORDE, e as de cima não bastam. Ao
    // sabotar o filtro para deixar passar rótulo vazio, o campo CONTINUAVA
    // renderizado -- só que sem nome -- e os `queryByLabelText` acima
    // continuavam devolvendo `null`, porque um label vazio não casa com nada.
    // Uma caixa de texto sem pergunta é pior que o campo indesejado.
    expect(document.querySelectorAll('input[id^="id-"]')).toHaveLength(3);
  });

  it("⚠️ e DEIXA DE SER EXIGIDO -- senão o avançar trava sem explicação", async () => {
    // Este é o defeito que a metade do trabalho causaria: o campo some da tela
    // mas continua obrigatório, e o botão fica cinza por um motivo invisível.
    montar({ telefone: null, area: null, polo: null });
    preencher([]);
    const avancar = (await screen.findByText(/Continuar|Avançar|Próximo/i))
      .closest("button")!;
    expect(avancar.disabled).toBe(false);
  });

  it("⚠️ o que o formulário NÃO pergunta vai como `null`, e não como \"\"", async () => {
    // ⚠️ O BACKEND DISTINGUE OS DOIS: `null` é "não perguntou", `""` é
    // "perguntou e ficou em branco". Mandar `""` poria na fila um campo vazio
    // como se a pessoa tivesse deixado em branco -- o que é mentira.
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
    // ⚠️ ACHADO PELA REVISÃO DE 31/08. A mensagem era fixa -- "Preencha nome,
    // e-mail válido, telefone, área e polo" -- e num formulário de TI ela
    // acusava a pessoa de pular "área e polo", campos que a tela nem desenha.
    // É exatamente o defeito que o comentário do `identOk()` diz que não pode
    // acontecer, escrito uma função acima.
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
    // A última tela antes de enviar é o pior lugar para uma dúvida: com o
    // telefone desligado, ela mostrava "Maria · maria@x ·" com um · solto.
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

  it("⚠️ o TÍTULO vem do banco -- ele estava escrito na mão", async () => {
    // `"FazAê · Solicitações de Marketing"` estava fixo aqui, mesmo com o
    // formulário tendo `title` no banco desde a fatia A.
    montar();
    expect(await screen.findByText("Pedido de acesso — TI")).toBeTruthy();
    expect(screen.queryByText(/FazAê/)).toBeNull();
  });

  it("a descrição do formulário substitui o texto genérico", async () => {
    montar();
    expect(await screen.findByText("Diga o que você precisa.")).toBeTruthy();
  });
});
