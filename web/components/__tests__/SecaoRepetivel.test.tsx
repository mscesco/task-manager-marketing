// Seção repetível no formulário público (Spec 059, 15/10).
//
// A pessoa preenche a mesma seção mais de uma vez no envio (vários eventos), e
// cada repetição vira UMA solicitação no mesmo protocolo. O que este arquivo
// prende: o botão de adicionar e o de remover, a validação POR repetição (o
// erro diz qual), o envio com um item por repetição e o teto de 20.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FormularioSolicitacao from "@/components/FormularioSolicitacao";
import { MAX_REPETICOES, type Categoria } from "@/lib/solicitacaoForm";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, enviarSolicitacaoPublica: vi.fn() };
});

const api = await import("@/lib/api");

const EVENTOS: Categoria = {
  slug: "eventos",
  titulo: "Cobertura de evento",
  emoji: "🎤",
  prazo: null,
  resumoDe: "nome",
  repetivel: true,
  rotuloRepeticao: "Evento",
  campos: [{ id: "nome", label: "Qual evento?", tipo: "texto", obrigatorio: true }],
};

function montar() {
  render(
    <FormularioSolicitacao
      categorias={[EVENTOS]}
      categoriaPorSlug={{ eventos: EVENTOS }}
      formId="f1"
      titulo="Eventos"
      descricao=""
      identificacao={{ telefone: null, area: null, polo: null }}
    />
  );
  fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Maria do Polo" } });
  fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: "maria@polo.ex" } });
  fireEvent.click(screen.getByText("Cobertura de evento"));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function campos() {
  return screen.getAllByLabelText(/^Qual evento\?/) as HTMLInputElement[];
}

beforeEach(() => {
  window.localStorage.clear();
  // O jsdom não tem `scrollIntoView`, e o avançar rola até o campo que falta.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("seção repetível", () => {
  it("adiciona outra repetição e envia UM item por repetição", async () => {
    vi.mocked(api.enviarSolicitacaoPublica).mockResolvedValue({ protocol: "ABC123", created: 2 });
    montar();
    expect(campos()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar outro evento" }));
    expect(campos()).toHaveLength(2);
    fireEvent.change(campos()[0], { target: { value: "Feira de profissões" } });
    fireEvent.change(campos()[1], { target: { value: "Aula inaugural" } });

    fireEvent.click(screen.getByRole("button", { name: "Revisar e enviar" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar 2 solicitações" }));

    await waitFor(() => expect(api.enviarSolicitacaoPublica).toHaveBeenCalled());
    const corpo = vi.mocked(api.enviarSolicitacaoPublica).mock.calls[0][0];
    expect(corpo.items.map((i) => [i.category, i.summary])).toEqual([
      ["eventos", "Feira de profissões"],
      ["eventos", "Aula inaugural"],
    ]);
  });

  it("⚠️ o erro diz QUAL repetição ficou incompleta", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar outro evento" }));
    fireEvent.change(campos()[0], { target: { value: "Feira" } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar e enviar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Qual evento\?.*\(evento 2\)/);
  });

  it("remover tira a repetição e as respostas dela", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar outro evento" }));
    fireEvent.change(campos()[0], { target: { value: "Feira" } });
    fireEvent.change(campos()[1], { target: { value: "Aula" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover evento 1" }));
    expect(campos().map((c) => c.value)).toEqual(["Aula"]);
    // Com uma só, não há o que remover.
    expect(screen.queryByRole("button", { name: /^Remover/ })).toBeNull();
  });

  it(`para em ${MAX_REPETICOES}`, () => {
    montar();
    // ⚠️ O BOTÃO É BUSCADO UMA VEZ: `getByRole` a cada volta (19 vezes) passava
    // dos 5 s com a suíte inteira rodando. O nó é o mesmo entre renders.
    const adicionar = screen.getByText("+ Adicionar outro evento");
    for (let i = 1; i < MAX_REPETICOES; i++) fireEvent.click(adicionar);
    expect(campos()).toHaveLength(MAX_REPETICOES);
    expect(screen.queryByRole("button", { name: "+ Adicionar outro evento" })).toBeNull();
    expect(screen.getByText(/Limite de 20 por envio/)).toBeTruthy();
  });
});
