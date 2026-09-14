/**
 * Spec 047, revisão de 10/09 — o que a tela do time lembra ao recarregar.
 *
 * ⚠️ POR QUE ESTES TESTES EXISTEM: o defeito clássico deste código não dá erro
 * nenhum. Ler `?aba=lixo` e devolver `"lixo"` faz a tabela filtrar por um
 * estado que ninguém tem — tela vazia, sem mensagem, sem log. E a URL é
 * digitável.
 *
 * SABOTAGENS medidas -- ver o fim do arquivo.
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

  it("⭐ lê o que a URL diz", () => {
    expect(lerEstadoDaTela("?ver=subtimes&aba=inativos")).toEqual({
      view: "structure",
      tab: "inactive",
    });
  });

  it("⭐⭐ valor desconhecido cai no PADRÃO, e não vaza para o estado", () => {
    // ⚠️ A URL é digitável. Um `?aba=lixo` que virasse estado faria a tabela
    // filtrar por um estado que ninguém tem: tela vazia, sem erro nenhum.
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
  it("escreve os dois parâmetros", () => {
    const url = urlDoEstado({ view: "structure", tab: "invited" }, "");
    expect(url).toContain("ver=subtimes");
    expect(url).toContain("aba=convidados");
  });

  it("⭐ PRESERVA o resto da query", () => {
    // ⚠️ Trocar de aba não pode apagar parâmetro de outra pessoa. Hoje não há
    // nenhum nesta rota, e é justamente por isso que o dia em que houver
    // ninguém vai lembrar de conferir.
    const url = urlDoEstado({ view: "people", tab: "active" }, "?destaque=abc");
    expect(url).toContain("destaque=abc");
  });

  it("⚠️ ida e volta: o que se escreve é o que se lê", () => {
    // ⚠️ Os nomes na URL são em PORTUGUÊS (`?ver=subtimes`) e os do tipo em
    // inglês (`"structure"`). São dois vocabulários, e a tradução mora só
    // aqui — este teste é quem garante que os dois mapas não divirjam.
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
  it("⚠️ troca o endereço SEM navegar", () => {
    // ⚠️ `replaceState` e não `push`: trocar de aba é ajuste de recorte, não
    // navegação. Com `push`, o botão Voltar percorreria cada clique de aba.
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
    // ⚠️ E mantém o caminho: sem ele, gravar levaria a raiz do site.
    expect(chamadas[0].startsWith(window.location.pathname)).toBe(true);
  });
});

// SABOTAGENS medidas:
//   A. Devolver o valor cru da URL em vez de mapear. **Cai 4**.
//   B. Montar a query do zero, sem preservar o resto. **Cai 1**.
//   C. Trocar `replaceState` por `pushState`. **Cai 1**.
