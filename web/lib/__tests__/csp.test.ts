// A Content-Security-Policy do produto (revisão de segurança, 23/09).
//
// ⚠️ POR QUE UM TESTE DE CABEÇALHO: a CSP não quebra nada quando fica FRACA
// demais -- a tela continua igual, e ninguém percebe até o dia do incidente.
// O erro contrário (apertar demais) aparece na hora. Então o guardião prende o
// lado silencioso: o que NÃO pode afrouxar.
//
// SABOTAGENS (medidas):
//   A. Pôr `'unsafe-eval'` também na lista de produção. Deve cair
//      "⚠️ produção não aceita 'unsafe-eval'".
//   B. Trocar `connect-src` por `*`. Deve cair "⚠️ connect-src não abre para
//      qualquer destino".

import { describe, expect, it } from "vitest";

import { csp, PERMISSIONS_POLICY } from "../../next.config.mjs";

/** As diretivas como mapa, para afirmar uma a uma. */
function diretivas(valor: string): Record<string, string[]> {
  return Object.fromEntries(
    valor.split(";").map((parte) => {
      const [nome, ...valores] = parte.trim().split(/\s+/);
      return [nome, valores];
    }),
  );
}

describe("a CSP de produção", () => {
  const prod = diretivas(csp(false));

  it("⚠️ produção não aceita 'unsafe-eval'", () => {
    // Fast Refresh precisa; o build não. Se vazar para produção, um XSS ganha
    // de volta o `eval` que a política existia para tirar.
    expect(csp(false)).not.toContain("'unsafe-eval'");
    expect(csp(true)).toContain("'unsafe-eval'");
  });

  it("⚠️ connect-src não abre para qualquer destino", () => {
    // ⚠️ ESTA É A LINHA QUE MAIS IMPORTA neste produto: os tokens ficam no
    // localStorage, então o dano de um XSS depende de conseguir MANDAR os
    // dados para fora. Com `'self'` + GIPHY, não consegue.
    expect(prod["connect-src"]).toEqual(["'self'", "https://api.giphy.com"]);
    expect(prod["connect-src"]).not.toContain("*");
  });

  it("nega o que o produto não usa", () => {
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["frame-src"]).toEqual(["'none'"]);
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
  });

  it("deixa passar exatamente o GIPHY nas imagens, e nada mais de fora", () => {
    expect(prod["img-src"]).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://*.giphy.com",
    ]);
  });

  it("⚠️ o `'unsafe-inline'` do script é consciente, e só dele", () => {
    // Enquanto não houver nonce (exige middleware), o Next precisa dele -- e o
    // comentário no `next.config.mjs` explica. O que este teste prende é que
    // ninguém o use como desculpa para afrouxar o resto.
    expect(prod["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(prod["default-src"]).toEqual(["'self'"]);
  });

  it("a política de permissões nega câmera, microfone e localização", () => {
    for (const recurso of ["camera", "microphone", "geolocation"]) {
      expect(PERMISSIONS_POLICY).toContain(`${recurso}=()`);
    }
  });
});
