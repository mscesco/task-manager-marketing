/**
 * O que a tela do time lembra ao recarregar. A URL é digitável: um valor
 * desconhecido que virasse estado deixaria a tabela vazia, sem erro nenhum.
 */

import { describe, it, expect } from "vitest";
import {
  gravarEstadoDaTela,
  lerEstadoDaTela,
  urlDoEstado,
} from "../estadoDaTela";

describe("lerEstadoDaTela", () => {
  it("sem query nenhuma, cai no padrão", () => {
    expect(lerEstadoDaTela("")).toEqual({ view: "people", tab: "active" });
  });

  it("lê o que a URL diz", () => {
    expect(lerEstadoDaTela("?ver=subtimes&aba=inativos")).toEqual({
      view: "structure",
      tab: "inactive",
    });
  });

  it("valor desconhecido cai no padrão, e não vaza para o estado", () => {
    expect(lerEstadoDaTela("?ver=lixo&aba=lixo")).toEqual({
      view: "people",
      tab: "active",
    });
  });

  it("cada parâmetro é independente do outro", () => {
    expect(lerEstadoDaTela("?aba=convidados")).toEqual({
      view: "people",
      tab: "invited",
    });
  });
});

describe("urlDoEstado", () => {

  it("preserva o resto da query", () => {
    const url = urlDoEstado({ view: "people", tab: "active" }, "?destaque=abc");
    expect(url).toContain("destaque=abc");
  });

  it("ida e volta: o que se escreve é o que se lê", () => {
    // Os nomes na URL são em português e os do tipo em inglês: os dois mapas
    // não podem divergir.
    const estados = [
      { view: "people", tab: "active" },
      { view: "people", tab: "invited" },
      { view: "structure", tab: "inactive" },
    ] as const;
    for (const e of estados) {
      expect(lerEstadoDaTela(urlDoEstado(e, ""))).toEqual(e);
    }
  });
});

describe("gravarEstadoDaTela", () => {
  it("troca o endereço sem navegar", () => {
    // `replaceState`, não `push`: com `push`, o Voltar percorreria cada aba.
    const chamadas: string[] = [];
    const original = window.history.replaceState;
    window.history.replaceState = ((_s: unknown, _t: string, url: string) => {
      chamadas.push(url);
    }) as typeof window.history.replaceState;

    gravarEstadoDaTela({ view: "structure", tab: "inactive" });

    window.history.replaceState = original;
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toContain("ver=subtimes");
    expect(chamadas[0]).toContain("aba=inativos");
    // E mantém o caminho: sem ele, gravar levaria à raiz do site.
    expect(chamadas[0].startsWith(window.location.pathname)).toBe(true);
  });
});
