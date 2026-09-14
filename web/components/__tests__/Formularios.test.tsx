// A tela de gestão dos formulários (Spec 043, fatia C — primeira metade).
//
// ⚠️ ATÉ AQUI O CRUD SÓ EXISTIA NA API. A fatia A o entregou dizendo, com
// todas as letras, que ele nascia sem chamador no front -- e um mês depois
// "cada equipe cria o seu formulário" ainda significaria `curl`. Esta tela é o
// chamador, e este arquivo é o portão dela.
//
// O que ele prende, e cada item é uma decisão e não uma preferência:
//   - sem `solicitation_form.manage`, a tela LÊ e não oferece ação nenhuma;
//   - o aviso do EXCLUIR diz o que acontece com as solicitações que já
//     chegaram (elas NÃO são apagadas);
//   - a mensagem do backend aparece INTEIRA quando publicar é recusado -- é
//     ela que ensina o próximo passo;
//   - o time padrão é a RAIZ, e não o primeiro da lista alfabética.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import FormulariosPage from "@/app/formularios/page";
import type { Formulario, Team } from "@/lib/api";
import {
  ActiveTeamProvider,
  type ActiveTeamContext,
} from "@/lib/useActiveTeam";

// ⚠⚠ O MOCK FORNECE O CONTEXTO DE TIME, porque o `AppShell` de verdade
// fornece (Spec 048, fatia E). Sem isto a tela fica carregando para sempre:
// ela ESPERA a barra resolver o time antes de listar.
//
// ⚠️ Variável mutável porque os testes precisam de valores diferentes, e a
// fábrica do `vi.mock` é içada -- não dá para parametrizá-la por teste. A
// fábrica não LÊ a variável (só o corpo do componente, no render): sem TDZ.
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <ActiveTeamProvider value={contextoDoTeste}>{children}</ActiveTeamProvider>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listarFormularios: vi.fn(),
    criarFormulario: vi.fn(),
    publicarFormulario: vi.fn(),
    apagarFormulario: vi.fn(),
    listTeamsAll: vi.fn(),
    currentUser: vi.fn(),
  };
});

const api = await import("@/lib/api");

/** O contexto que o `AppShell` falso entrega. Reposto no `afterEach`. */
const CONTEXTO_PADRAO: ActiveTeamContext = {
  active: { kind: "team", teamId: "t-raiz", fromUrl: true },
  search: "?time=t-raiz",
  teamName: "Marketing",
        teams: [],
      };
let contextoDoTeste: ActiveTeamContext = CONTEXTO_PADRAO;

const RAIZ = "t-raiz";
const SUB = "t-sub";

function time(id: string, name: string, parent: string | null): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: parent,
    name,
    slug: name.toLowerCase(),
  };
}

function formulario(over: Partial<Formulario> = {}): Formulario {
  return {
    id: "f1",
    team_id: RAIZ,
    slug: "marketing",
    title: "Solicitação ao Marketing",
    description: "",
    is_published: true,
    phone_label: "Telefone",
    department_label: "Área / Departamento",
    polo_label: "Polo",
    ...over,
  };
}

function montar(
  itens: Formulario[] = [formulario()],
  permissoes: string[] = ["form.update"]
) {
  vi.mocked(api.listarFormularios).mockResolvedValue(itens);
  // ⚠️ "Audiovisual" ANTES da raiz de propósito: se a tela pegar o primeiro da
  // lista em vez da raiz, o teste do padrão cai.
  vi.mocked(api.listTeamsAll).mockResolvedValue([
    time(SUB, "Audiovisual", RAIZ),
    time(RAIZ, "Marketing", null),
  ]);
  vi.mocked(api.currentUser).mockResolvedValue({
    permissions: permissoes,
  } as never);
  render(<FormulariosPage />);
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  // ⚠️ DEVOLVE O CONTEXTO PADRÃO: sem isto o valor do último teste vazaria
  // para os de cima, e eles falhariam na ORDEM em que rodam -- o pior tipo de
  // teste quebrado, porque a causa não está no teste que falha.
  contextoDoTeste = CONTEXTO_PADRAO;
});

describe("Formulários -- a lista", () => {
  it("mostra título, endereço, time e situação", async () => {
    montar();
    expect(await screen.findByText("Solicitação ao Marketing")).toBeTruthy();
    expect(screen.getByText("/solicitar/marketing")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Marketing")).toBeTruthy());
    expect(screen.getByText("Publicado")).toBeTruthy();
  });

  it("⚠️ sem a permissão, a tela LÊ e não oferece ação nenhuma", async () => {
    // ⚠️ O backend barra por 403 de qualquer forma; esconder aqui evita
    // oferecer uma porta que não abre. Mesmo espírito dos gates de
    // Solicitações e Times na barra lateral.
    montar([formulario()], ["solicitation.read"]);
    expect(await screen.findByText("Solicitação ao Marketing")).toBeTruthy();
    expect(screen.queryByText("+ Novo formulário")).toBeNull();
    expect(screen.queryByText("Despublicar")).toBeNull();
    expect(screen.queryByText("Excluir")).toBeNull();
  });

  it("lista vazia explica para que serve criar um", async () => {
    montar([]);
    expect(await screen.findByText(/Nenhum formulário ainda/i)).toBeTruthy();
  });
});

describe("Formulários -- criar", () => {
  it("⚠⚠ o time padrão é o TIME ATIVO (reescrito na Spec 048)", async () => {
    // O argumento original deste teste segue valendo, e é dele que sai a
    // correção: *"o time é ESCOLHA DEFINITIVA, então o padrão errado vira
    // formulário no time errado sem volta"*.
    //
    // ⚠️ O QUE MUDOU: o padrão era "a primeira raiz", e o comentário antigo o
    // justificava com *"em produção o Marketing É a raiz"* -- verdade quando
    // foi escrito, e mentira desde a Spec 046. Com duas raizes,
    // `find(parent === null)` devolve a primeira que a API listar, e o
    // formulário nasceria no Comercial enquanto a pessoa olha o Marketing.
    // Mesmo defeito que o `createProject` pagou em 10/09.
    contextoDoTeste = {
      active: { kind: "team", teamId: SUB, fromUrl: true },
      search: `?time=${SUB}`,
      teamName: "SEO",
        teams: [],
      };
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    const select = screen.getByLabelText("Time responsável") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(SUB));
  });

  it("sem time ativo, o padrão cai na RAIZ (a reserva de sempre)", async () => {
    // `kind: "none"`: a pessoa não tem vínculo, ou a árvore não chegou. A
    // reserva antiga continua lá -- ela só deixou de ser a primeira resposta.
    contextoDoTeste = { active: { kind: "none" }, search: "", teamName: null,
        teams: [],
      };
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    const select = screen.getByLabelText("Time responsável") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(RAIZ));
  });

  it("⚠️ e o time ativo NÃO PISA numa escolha já feita", async () => {
    // O efeito que preenche o campo roda de novo a cada troca de time. Se ele
    // fizesse `setTime(timeAtivo)` em vez de `atual || timeAtivo`, apagaria o
    // time que a pessoa acabou de escolher no formulário aberto.
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    const select = screen.getByLabelText("Time responsável") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(RAIZ));
    fireEvent.change(select, { target: { value: SUB } });
    await waitFor(() => expect(select.value).toBe(SUB));
  });

  it("mostra a URL que o endereço vai gerar, enquanto se digita", async () => {
    // ⚠️ O slug É o endereço que alguém vai divulgar. Ver `/solicitar/<isto>`
    // na hora de digitar evita descobrir depois que ficou feio no cartaz.
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    fireEvent.change(screen.getByLabelText("Endereço"), {
      target: { value: "ti-acesso" },
    });
    expect(screen.getByText("/solicitar/ti-acesso")).toBeTruthy();
  });

  it("⚠️ avisa que o time NÃO muda depois", async () => {
    // O time decide quem tria -- inclusive as solicitações que já chegaram --,
    // e por isso o backend recusa trocá-lo. Descobrir isso depois de criar
    // seria refazer o formulário inteiro.
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    expect(screen.getByText(/Não dá para mudar depois/i)).toBeTruthy();
  });

  it("cria e acrescenta à lista", async () => {
    vi.mocked(api.criarFormulario).mockResolvedValue(
      formulario({ id: "f2", slug: "ti", title: "Pedido de acesso", is_published: false })
    );
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    fireEvent.change(screen.getByLabelText("Título"), {
      target: { value: "Pedido de acesso" },
    });
    fireEvent.change(screen.getByLabelText("Endereço"), {
      target: { value: "ti" },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(api.criarFormulario).toHaveBeenCalledWith({
        team_id: RAIZ,
        slug: "ti",
        title: "Pedido de acesso",
      })
    );
    expect(await screen.findByText("Pedido de acesso")).toBeTruthy();
  });

  it("⚠️ a recusa do backend aparece INTEIRA", async () => {
    // ⚠️ Slug inválido e repetido têm mensagem própria no domínio. Reescrevê-la
    // aqui criaria uma segunda versão da regra, que divergiria na primeira
    // mudança -- e a daqui seria a errada, porque a decisão é do servidor.
    vi.mocked(api.criarFormulario).mockRejectedValue(
      Object.assign(new Error("Já existe um formulário com este endereço."), {
        status: 422,
      })
    );
    montar([]);
    fireEvent.click(await screen.findByText("+ Novo formulário"));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Endereço"), { target: { value: "marketing" } });
    fireEvent.click(screen.getByText("Criar"));

    expect(
      await screen.findByText("Já existe um formulário com este endereço.")
    ).toBeTruthy();
  });
});

describe("Formulários -- publicar e excluir", () => {
  it("publicar sem pergunta mostra o motivo que o backend deu", async () => {
    // ⚠️ ESTA MENSAGEM ENSINA O PRÓXIMO PASSO ("monte as perguntas antes"), e
    // é por isso que ela aparece inteira em vez de virar "não consegui".
    vi.mocked(api.publicarFormulario).mockRejectedValue(
      Object.assign(
        new Error("Um formulário sem perguntas não pode ser publicado."),
        { status: 422 }
      )
    );
    montar([formulario({ is_published: false })]);
    fireEvent.click(await screen.findByText("Publicar"));

    expect(
      await screen.findByText("Um formulário sem perguntas não pode ser publicado.")
    ).toBeTruthy();
  });

  it("⚠️ o aviso do excluir diz que as solicitações NÃO são apagadas", async () => {
    // O soft delete marca o FORMULÁRIO e não toca nelas: continuam na fila (o
    // `JOIN` é `LEFT`) e continuam legíveis, porque cada uma guarda o texto das
    // perguntas que respondeu. Quem lê "excluir formulário" imagina o
    // contrário.
    montar();
    fireEvent.click(await screen.findByText("Excluir"));
    const texto = vi.mocked(window.confirm).mock.calls[0][0] as string;
    expect(texto).toMatch(/NÃO são apagadas/i);
  });

  it("⚠️ e avisa quando o que vai sair do ar está PUBLICADO", async () => {
    // Apagar um rascunho não tem consequência externa; apagar um publicado
    // derruba um endereço que pode estar num cartaz.
    montar([formulario({ is_published: true })]);
    fireEvent.click(await screen.findByText("Excluir"));
    expect(vi.mocked(window.confirm).mock.calls[0][0] as string).toMatch(
      /PUBLICADO/
    );
  });

  it("cancelar a confirmação não chama a API", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    montar();
    fireEvent.click(await screen.findByText("Excluir"));
    expect(api.apagarFormulario).not.toHaveBeenCalled();
  });
});
