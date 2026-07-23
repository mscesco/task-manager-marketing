// Tema claro/escuro/sistema (lib/tema.ts).
//
// Precisa de jsdom (Spec 027, D2): o modulo usa localStorage, matchMedia e
// document.documentElement.
//
// jsdom NAO implementa matchMedia -- por isso ele e injetado a mao nos testes
// que dependem dele. Isso tambem deixa o teste escolher "SO no escuro" sem
// depender da maquina.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_TEMA,
  TEMA_PADRAO,
  aplicarTema,
  gravarTema,
  lerTema,
  observarTemaDoSistema,
  proximoTema,
  resolverTema,
  type Tema,
} from "@/lib/tema";

/** Instala um matchMedia falso que responde `escuro` ao media query do SO. */
function fingirSistema(escuro: boolean) {
  const ouvintes: Array<() => void> = [];
  const mq = {
    matches: escuro,
    addEventListener: (_: string, cb: () => void) => ouvintes.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      const i = ouvintes.indexOf(cb);
      if (i >= 0) ouvintes.splice(i, 1);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mq)
  );
  return { ouvintes, disparar: () => ouvintes.forEach((cb) => cb()) };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proximoTema -- ordem do botao que cicla", () => {
  it("claro -> escuro -> sistema -> claro (ciclo fecha)", () => {
    expect(proximoTema("claro")).toBe("escuro");
    expect(proximoTema("escuro")).toBe("sistema");
    expect(proximoTema("sistema")).toBe("claro");
  });

  it("tres cliques voltam ao ponto de partida", () => {
    let t: Tema = "claro";
    t = proximoTema(proximoTema(proximoTema(t)));
    expect(t).toBe("claro");
  });
});

describe("lerTema / gravarTema", () => {
  it("sem nada salvo -> padrao", () => {
    expect(lerTema()).toBe(TEMA_PADRAO);
  });

  it("le o que foi gravado", () => {
    gravarTema("escuro");
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe("escuro");
    expect(lerTema()).toBe("escuro");
  });

  it("valor invalido no storage -> padrao (nao propaga lixo)", () => {
    window.localStorage.setItem(CHAVE_TEMA, "roxo");
    expect(lerTema()).toBe(TEMA_PADRAO);
  });

  it("localStorage que LANCA nao quebra a pagina (modo privado)", () => {
    // Cenario real: navegador com cookies bloqueados. O tema nao vale
    // derrubar a aplicacao -- tem que cair no padrao em silencio.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("acesso negado");
    });
    expect(() => lerTema()).not.toThrow();
    expect(lerTema()).toBe(TEMA_PADRAO);
  });

  it("gravar com storage que LANCA nao estoura", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("acesso negado");
    });
    expect(() => gravarTema("escuro")).not.toThrow();
  });
});

describe("resolverTema -- preferencia vira o que se pinta", () => {
  it("escolha explicita ignora o SO", () => {
    fingirSistema(true); // SO no escuro
    expect(resolverTema("claro")).toBe("claro");
    fingirSistema(false); // SO no claro
    expect(resolverTema("escuro")).toBe("escuro");
  });

  it("'sistema' segue o SO no escuro", () => {
    fingirSistema(true);
    expect(resolverTema("sistema")).toBe("escuro");
  });

  it("'sistema' segue o SO no claro", () => {
    fingirSistema(false);
    expect(resolverTema("sistema")).toBe("claro");
  });

  it("sem matchMedia no navegador -> claro (degrada, nao quebra)", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(resolverTema("sistema")).toBe("claro");
  });
});

describe("aplicarTema -- contrato com o CSS", () => {
  it("escreve data-theme no <html>", () => {
    aplicarTema("escuro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("escuro");
  });

  it("NUNCA escreve 'sistema' no DOM -- o CSS so conhece claro/escuro", () => {
    // Se "sistema" vazasse pro atributo, o seletor [data-theme="escuro"]
    // do globals.css nao casaria e o tema escuro sumiria.
    fingirSistema(true);
    aplicarTema("sistema");
    expect(document.documentElement.getAttribute("data-theme")).toBe("escuro");

    fingirSistema(false);
    aplicarTema("sistema");
    expect(document.documentElement.getAttribute("data-theme")).toBe("claro");
  });
});

describe("observarTemaDoSistema", () => {
  it("chama o callback quando o SO troca", () => {
    const { disparar } = fingirSistema(false);
    const aoMudar = vi.fn();
    observarTemaDoSistema(aoMudar);
    disparar();
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("a funcao de limpeza remove o ouvinte (sem vazamento)", () => {
    const { disparar, ouvintes } = fingirSistema(false);
    const aoMudar = vi.fn();
    const limpar = observarTemaDoSistema(aoMudar);
    limpar();
    expect(ouvintes).toHaveLength(0);
    disparar();
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("sem matchMedia devolve limpeza inofensiva", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => observarTemaDoSistema(() => {})()).not.toThrow();
  });
});
