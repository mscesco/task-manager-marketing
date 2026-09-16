// Spec 051, fatia E -- os botões da CONTA na gaveta do membro vêm do servidor.
//
// ⚠️ O CASO QUE ESTE ARQUIVO PRENDE: o gerente abre a gaveta de OUTRO gerente
// da árvore dele. O alcance dele é "amplo" (ele move gente entre subtimes), e a
// gaveta desenhava "Resetar senha" e "Desativar" por esse alcance -- mas desde o
// conserto de 16/09 (#57) o servidor recusa as duas ações nessa conta. Os botões
// passaram a sair de `GET /members/{id}/account-actions`.
//
// ⚠️ POR ISSO O `scope` DE TODOS OS TESTES É "amplo": é o alcance que enganava
// a tela. O que muda de um teste para o outro é só a resposta do servidor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import MemberDrawer from "@/components/MemberDrawer";
import type { Member } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listMemberTeams: vi.fn(),
    memberAccountActions: vi.fn(),
  };
});

const api = await import("@/lib/api");

const OUTRO_GERENTE: Member = {
  id: "user-gerente-2",
  workspace_id: "ws",
  name: "Outro Gerente",
  email: "gerente2@t.dev",
  is_active: true,
  org_role: null,
  team_ids: [],
};

function montar() {
  render(
    <MemberDrawer
      member={OUTRO_GERENTE}
      teams={[]}
      scope={{ tipo: "amplo" }}
      isAdmin={false}
      opcoesDeOrganizacao={null}
      isSelf={false}
      permissoes={["person.update", "person.deactivate", "membership.move"]}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.mocked(api.listMemberTeams).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemberDrawer -- os botões da conta vêm do servidor (Spec 051, fatia E)", () => {
  it("⚠️ servidor diz que não: sem Resetar senha e sem Desativar -- com alcance amplo", async () => {
    vi.mocked(api.memberAccountActions).mockResolvedValue({
      can_reset_password: false,
      can_deactivate: false,
    });
    montar();
    await waitFor(() =>
      expect(api.memberAccountActions).toHaveBeenCalledWith("user-gerente-2"),
    );
    // A resposta chegou e os vínculos também: a partir daqui a ausência vale.
    expect(await screen.findByText(/Sem vínculo de time/)).toBeTruthy();

    expect(screen.queryByText("Resetar senha")).toBeNull();
    expect(screen.queryByText("Desativar")).toBeNull();
  });

  it("servidor diz que sim: os dois botões aparecem", async () => {
    vi.mocked(api.memberAccountActions).mockResolvedValue({
      can_reset_password: true,
      can_deactivate: true,
    });
    montar();

    expect(await screen.findByText("Resetar senha")).toBeTruthy();
    expect(await screen.findByText("Desativar")).toBeTruthy();
  });

  it("enquanto o servidor não responde, nenhum botão por palpite", async () => {
    vi.mocked(api.memberAccountActions).mockReturnValue(new Promise(() => {}));
    montar();
    expect(await screen.findByText(/Sem vínculo de time/)).toBeTruthy();

    expect(screen.queryByText("Resetar senha")).toBeNull();
    expect(screen.queryByText("Desativar")).toBeNull();
  });
});
