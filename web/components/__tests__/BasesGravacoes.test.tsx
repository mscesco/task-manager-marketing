// Revisão de 08/10 -- as corridas das gravações de célula da Base.
//
// O QUE ESTE ARQUIVO PRENDE:
//   - duas edições na mesma linha em voo: a resposta MAIS VELHA que chega por
//     último não desfaz a mais nova (`version`);
//   - o erro de uma célula desfaz SÓ aquela célula, e não a linha inteira;
//   - `lib/gravacoesDaBase`: a gravação conta enquanto está em voo, a geração
//     sobe a cada uma, e `esperarGravacoes` espera inclusive as que falham.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useGravarCelula } from "@/components/bases/useGravarCelula";
import type { BaseColumn, BaseRow } from "@/lib/api";
import {
  acompanhar,
  esperarGravacoes,
  geracao,
  haGravando,
} from "@/lib/gravacoesDaBase";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, updateBaseCells: vi.fn() };
});
const api = await import("@/lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const A = { id: "col-a", type: "text" } as BaseColumn;
const B = { id: "col-b", type: "text" } as BaseColumn;

function linha(values: BaseRow["values"], version: number): BaseRow {
  return { id: "r1", values, version } as BaseRow;
}

/** As linhas da tela, com o mesmo `onLinhas` da página. */
function tela(inicial: BaseRow[]) {
  let linhas = inicial;
  const onLinhas = (f: (l: BaseRow[]) => BaseRow[]) => {
    linhas = f(linhas);
  };
  const { result } = renderHook(() => useGravarCelula("base-1", onLinhas));
  return { gravar: result.current, linhas: () => linhas };
}

function adiada<T>() {
  let soltar!: (v: T) => void;
  let falhar!: (e: unknown) => void;
  const p = new Promise<T>((s, f) => {
    soltar = s;
    falhar = f;
  });
  return { p, soltar, falhar };
}

describe("useGravarCelula", () => {
  it("⚠️ a resposta velha que chega por último não desfaz a nova", async () => {
    const r1 = adiada<BaseRow[]>();
    const r2 = adiada<BaseRow[]>();
    vi.mocked(api.updateBaseCells)
      .mockReturnValueOnce(r1.p)
      .mockReturnValueOnce(r2.p);
    const t = tela([linha({}, 1)]);

    let g1!: Promise<void>;
    let g2!: Promise<void>;
    act(() => {
      g1 = t.gravar(t.linhas()[0], A, "x");
    });
    act(() => {
      g2 = t.gravar(t.linhas()[0], B, "y");
    });
    await act(async () => {
      r2.soltar([linha({ "col-a": "x", "col-b": "y" }, 3)]);
      await g2;
      r1.soltar([linha({ "col-a": "x" }, 2)]);
      await g1;
    });

    expect(t.linhas()[0].values).toEqual({ "col-a": "x", "col-b": "y" });
    expect(t.linhas()[0].version).toBe(3);
  });

  it("⚠️ o erro desfaz só a própria célula", async () => {
    const r1 = adiada<BaseRow[]>();
    const r2 = adiada<BaseRow[]>();
    vi.mocked(api.updateBaseCells)
      .mockReturnValueOnce(r1.p)
      .mockReturnValueOnce(r2.p);
    const t = tela([linha({ "col-b": "antes" }, 1)]);

    // B sai primeiro (a linha dele ainda não tem A); A sai depois e dá certo.
    let gA!: Promise<void>;
    let gB!: Promise<void>;
    act(() => {
      gB = t.gravar(t.linhas()[0], B, "depois");
    });
    act(() => {
      gA = t.gravar(t.linhas()[0], A, "x");
    });
    await act(async () => {
      r2.soltar([linha({ "col-a": "x", "col-b": "antes" }, 2)]);
      await gA;
      r1.falhar(new Error("recusado"));
      await gB;
    });

    // A edição de A deu certo e fica; só B volta.
    expect(t.linhas()[0].values).toEqual({ "col-a": "x", "col-b": "antes" });
  });
});

describe("gravacoesDaBase", () => {
  it("conta em voo, sobe a geração e espera inclusive a que falha", async () => {
    const g0 = geracao("b-x");
    const ok = adiada<number>();
    const ruim = adiada<number>();
    acompanhar("b-x", ok.p);
    acompanhar("b-x", ruim.p).catch(() => {});
    expect(haGravando("b-x")).toBe(true);
    expect(geracao("b-x")).toBe(g0 + 2);
    expect(haGravando("outra-base")).toBe(false);

    const espera = esperarGravacoes("b-x");
    ok.soltar(1);
    ruim.falhar(new Error("x"));
    await espera;
    await Promise.resolve();
    expect(haGravando("b-x")).toBe(false);
  });
});
