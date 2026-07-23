// ?task= na URL em sincronia com a tarefa aberta (lib/urlTarefa.ts).
//
// Precisa de jsdom (Spec 027, D2): usa location e history.replaceState.
// Cada teste posiciona a URL com um replaceState REAL antes de espionar,
// para o espiao contar so as chamadas do modulo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerTaskDaUrl, sincronizarTaskNaUrl } from "@/lib/urlTarefa";

const ID_A = "914749c6-f35c-4609-a167-f83339d8bb94";
const ID_B = "9393ab5a-8d13-4b6a-98d8-71a56ea1dba2";

/** Posiciona a URL da aba sem envolver o modulo sob teste. */
function irPara(url: string) {
  window.history.replaceState(null, "", url);
}

beforeEach(() => {
  irPara("/quadro");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("sincronizarTaskNaUrl -- grava e remove", () => {
  it("adiciona ?task= quando abre uma tarefa", () => {
    sincronizarTaskNaUrl(ID_A);
    expect(window.location.search).toBe(`?task=${ID_A}`);
  });

  it("troca o id quando abre outra tarefa", () => {
    sincronizarTaskNaUrl(ID_A);
    sincronizarTaskNaUrl(ID_B);
    expect(window.location.search).toBe(`?task=${ID_B}`);
  });

  it("remove o ?task= quando fecha", () => {
    sincronizarTaskNaUrl(ID_A);
    sincronizarTaskNaUrl(null);
    expect(window.location.search).toBe("");
  });

  it("preserva os outros parametros da URL", () => {
    irPara("/quadro?filtro=meus&subtime=design");
    sincronizarTaskNaUrl(ID_A);
    const p = new URLSearchParams(window.location.search);
    expect(p.get("filtro")).toBe("meus");
    expect(p.get("subtime")).toBe("design");
    expect(p.get("task")).toBe(ID_A);
  });

  it("preserva o caminho (nao navega para outra rota)", () => {
    irPara("/quadro/design");
    sincronizarTaskNaUrl(ID_A);
    expect(window.location.pathname).toBe("/quadro/design");
  });
});

describe("sincronizarTaskNaUrl -- nao chama replaceState a toa", () => {
  it("nao chama quando a URL JA esta com o id certo", () => {
    sincronizarTaskNaUrl(ID_A);
    const espiao = vi.spyOn(window.history, "replaceState");
    sincronizarTaskNaUrl(ID_A); // mesmo id de novo
    expect(espiao).not.toHaveBeenCalled();
  });

  it("nao chama ao fechar o que ja estava fechado", () => {
    const espiao = vi.spyOn(window.history, "replaceState");
    sincronizarTaskNaUrl(null);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("chama uma unica vez quando ha mudanca de verdade", () => {
    const espiao = vi.spyOn(window.history, "replaceState");
    sincronizarTaskNaUrl(ID_A);
    expect(espiao).toHaveBeenCalledTimes(1);
  });
});

describe("sincronizarTaskNaUrl -- preserva o history.state", () => {
  it("repassa o state atual, nao null", () => {
    // O App Router guarda estado proprio em history.state. Passar null faria
    // o router perder a referencia da rota -- por isso o modulo repassa.
    window.history.replaceState({ marcaDoRouter: 42 }, "", "/quadro");
    const espiao = vi.spyOn(window.history, "replaceState");
    sincronizarTaskNaUrl(ID_A);
    expect(espiao.mock.calls[0][0]).toEqual({ marcaDoRouter: 42 });
  });
});

describe("lerTaskDaUrl", () => {
  it("devolve o id presente na URL", () => {
    irPara(`/quadro?task=${ID_A}`);
    expect(lerTaskDaUrl()).toBe(ID_A);
  });

  it("devolve null quando nao ha parametro", () => {
    irPara("/quadro");
    expect(lerTaskDaUrl()).toBeNull();
  });

  it("ignora outros parametros", () => {
    irPara("/quadro?filtro=meus");
    expect(lerTaskDaUrl()).toBeNull();
  });

  it("le de volta o que sincronizarTaskNaUrl gravou (ida e volta)", () => {
    sincronizarTaskNaUrl(ID_B);
    expect(lerTaskDaUrl()).toBe(ID_B);
  });
});
