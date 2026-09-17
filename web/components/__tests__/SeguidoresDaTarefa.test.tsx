// Spec 053, fatia D -- seguir uma tarefa, no detalhe.
//
// O que se prende aqui e a MONTAGEM (a regra esta em `lib/seguidores.ts`):
//   - o botao do topo e a linha leem o MESMO estado;
//   - "Seguir" manda o POST SEM user_id (a propria pessoa);
//   - arquivada: a lista aparece, sem botao e sem `+`;
//   - o `+` so aparece com `can_manage_watchers`;
//   - falha volta atras e avisa.
//
// SABOTAGEM (medida): em `BotaoSeguir`, trocar `estado.alternar(meuId, true)`
// por `estado.alternar(meuId, false)`. Deve cair "Seguir manda o POST sem
// user_id" -- o POST passaria a levar o proprio id, que o servidor trataria
// como "por OUTRA pessoa" e cobraria a permissao.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  BotaoSeguir,
  LinhaDeSeguidores,
  useSeguidores,
} from "@/components/SeguidoresDaTarefa";
import { ApiError } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    listWatchers: vi.fn(),
    addWatcher: vi.fn(),
    removeWatcher: vi.fn(),
  };
});

const api = await import("@/lib/api");

const EU = "u-eu";
const ANA = "u-ana";
const NOMES = new Map([
  [EU, { name: "Eu Mesma" }],
  [ANA, { name: "Ana Souza" }],
]);

function Detalhe({
  arquivada = false,
  podeGerenciar = true,
  inativos = new Set<string>(),
  avisar = vi.fn(),
}: {
  arquivada?: boolean;
  podeGerenciar?: boolean;
  inativos?: Set<string>;
  avisar?: (t: string) => void;
}) {
  const estado = useSeguidores("t1", avisar);
  return (
    <>
      <BotaoSeguir estado={estado} meuId={EU} arquivada={arquivada} />
      <LinhaDeSeguidores
        estado={estado}
        meuId={EU}
        arquivada={arquivada}
        podeGerenciar={podeGerenciar}
        nomes={NOMES}
        inativos={inativos}
        foraDoEscopo={new Set()}
      />
    </>
  );
}

beforeEach(() => {
  vi.mocked(api.listWatchers).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("seguir, no detalhe da tarefa", () => {
  it("Seguir manda o POST sem user_id, e o botao e a linha mudam juntos", async () => {
    vi.mocked(api.addWatcher).mockResolvedValue([EU]);
    render(<Detalhe />);

    fireEvent.click(await screen.findByRole("button", { name: "Seguir" }));

    expect(api.addWatcher).toHaveBeenCalledWith("t1", undefined);
    expect(await screen.findByRole("button", { name: "Deixar de seguir" })).toBeTruthy();
    expect(screen.getByText("Eu M.")).toBeTruthy(); // pilula com o nome curto
  });

  it("Deixar de seguir chama o DELETE do proprio id", async () => {
    vi.mocked(api.listWatchers).mockResolvedValue([EU]);
    vi.mocked(api.removeWatcher).mockResolvedValue([]);
    render(<Detalhe />);

    fireEvent.click(await screen.findByRole("button", { name: "Deixar de seguir" }));

    expect(api.removeWatcher).toHaveBeenCalledWith("t1", EU);
    expect(await screen.findByRole("button", { name: "Seguir" })).toBeTruthy();
  });

  it("⚠️ arquivada: a lista aparece, sem botao e sem +", async () => {
    vi.mocked(api.listWatchers).mockResolvedValue([ANA]);
    render(<Detalhe arquivada />);

    expect(await screen.findByText("Ana S.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /seguir/i })).toBeNull();
    expect(screen.queryByLabelText("Escolher seguidores")).toBeNull();
  });

  it("sem can_manage_watchers nao ha +, mas o botao do topo continua", async () => {
    render(<Detalhe podeGerenciar={false} />);

    expect(await screen.findByRole("button", { name: "Seguir" })).toBeTruthy();
    expect(screen.queryByLabelText("Escolher seguidores")).toBeNull();
  });

  it("com permissao, o + poe OUTRA pessoa pelo id dela", async () => {
    vi.mocked(api.addWatcher).mockResolvedValue([ANA]);
    render(<Detalhe />);

    fireEvent.click(await screen.findByLabelText("Escolher seguidores"));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Souza/ }));

    expect(api.addWatcher).toHaveBeenCalledWith("t1", ANA);
  });

  it("falha volta atras e avisa com a frase da regra", async () => {
    vi.mocked(api.addWatcher).mockRejectedValue(new ApiError(422, "x", "tarefa_arquivada"));
    const avisar = vi.fn();
    render(<Detalhe avisar={avisar} />);

    fireEvent.click(await screen.findByRole("button", { name: "Seguir" }));

    await waitFor(() =>
      expect(avisar).toHaveBeenCalledWith("Tarefa arquivada: os seguidores não podem mudar."),
    );
    expect(await screen.findByRole("button", { name: "Seguir" })).toBeTruthy();
  });

  it("seguidor desativado aparece riscado, com (desativado) no title", async () => {
    vi.mocked(api.listWatchers).mockResolvedValue([ANA]);
    render(<Detalhe inativos={new Set([ANA])} />);

    const pilula = (await screen.findByText("Ana S.")).closest("span[title]");
    expect(pilula?.getAttribute("title")).toBe("Ana Souza (desativado)");
    expect(pilula?.className).toContain("line-through");
  });
});
