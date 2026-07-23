// =====================================================
// TESTE DE SEGURANCA (Spec 027, D8)
// -----------------------------------------------------
// Os casos de esquema (`javascript:`, `data:`, `file:`) NAO podem ser
// removidos nem afrouxados sem spec propria.
//
// Por que isto e seguranca e nao estetica: o React 18 NAO bloqueia
// href="javascript:...", so emite um warning e renderiza. Comentario e
// conteudo de usuario -> casar esquema livre seria XSS direto no app.
// A defesa e a regex exigir literalmente http:// ou https://. Se alguem
// "melhorar" essa regex um dia, e AQUI que o estrago aparece.
// =====================================================
import React from "react";
import { describe, expect, it } from "vitest";

import { linkify } from "@/lib/linkify";

/** Junta o texto de todos os nos (string ou <a>) numa string so. */
function textoDe(nos: React.ReactNode[]): string {
  return nos
    .map((n) => {
      if (typeof n === "string") return n;
      const el = n as React.ReactElement<{ children?: string }>;
      return el.props?.children ?? "";
    })
    .join("");
}

/** So os elementos <a> gerados. */
function ancoras(
  nos: React.ReactNode[]
): React.ReactElement<{ href: string; rel: string; target: string }>[] {
  return nos.filter(
    (n) => typeof n !== "string"
  ) as React.ReactElement<{ href: string; rel: string; target: string }>[];
}

describe("linkify -- esquemas perigosos NUNCA viram link", () => {
  it.each([
    ["javascript:", "clique javascript:alert(1) agora"],
    ["data:", "olha data:text/html,<script>alert(1)</script>"],
    ["file:", "abre file:///etc/passwd"],
    ["vbscript:", "vbscript:msgbox(1)"],
  ])("nao linka %s", (_nome, entrada) => {
    const nos = linkify(entrada, "k");
    expect(ancoras(nos)).toHaveLength(0);
  });

  it("nao linka esquema perigoso nem colado num http valido", () => {
    // Tentativa de esconder o esquema atras de um link legitimo.
    const nos = linkify("https://ok.com javascript:alert(1)", "k");
    const as = ancoras(nos);
    expect(as).toHaveLength(1);
    expect(as[0].props.href).toBe("https://ok.com");
  });

  it("nao casa dominio sem esquema (www.x.com fica texto)", () => {
    // Decisao registrada no proprio modulo: inventar o https:// seria
    // adivinhar intencao.
    expect(ancoras(linkify("veja www.exemplo.com", "k"))).toHaveLength(0);
  });
});

describe("linkify -- http/https viram link com os rel corretos", () => {
  it("linka http e https", () => {
    expect(ancoras(linkify("http://a.com", "k"))).toHaveLength(1);
    expect(ancoras(linkify("https://a.com", "k"))).toHaveLength(1);
  });

  it("usa rel=noopener noreferrer e target=_blank", () => {
    // noopener trava tabnabbing; noreferrer nao vaza a URL interna.
    const a = ancoras(linkify("https://a.com/x", "k"))[0];
    expect(a.props.rel).toBe("noopener noreferrer");
    expect(a.props.target).toBe("_blank");
  });

  it("devolve NOS REACT, nunca string de HTML", () => {
    // O app nao tem dangerouslySetInnerHTML fora do script de tema; se este
    // modulo passasse a devolver HTML cru, viraria vetor de injecao.
    const nos = linkify("https://a.com", "k");
    expect(typeof nos[0]).not.toBe("string");
    expect(React.isValidElement(nos[0])).toBe(true);
  });

  it("linka mais de uma URL no mesmo texto", () => {
    const nos = linkify("a https://um.com b https://dois.com c", "k");
    expect(ancoras(nos).map((a) => a.props.href)).toEqual([
      "https://um.com",
      "https://dois.com",
    ]);
  });
});

describe("linkify -- aparo do fim da URL", () => {
  it("o ponto final da frase fica FORA do link", () => {
    const nos = linkify("veja https://x.com/a.", "k");
    expect(ancoras(nos)[0].props.href).toBe("https://x.com/a");
    // E o ponto nao some da tela.
    expect(textoDe(nos)).toBe("veja https://x.com/a.");
  });

  it.each([",", ";", ":", "!", "?"])(
    "apara a pontuacao final '%s'",
    (sinal) => {
      const nos = linkify(`veja https://x.com/a${sinal}`, "k");
      expect(ancoras(nos)[0].props.href).toBe("https://x.com/a");
    }
  );

  it("o ) que fecha o parenteses do TEXTO fica fora", () => {
    const nos = linkify("(ver https://x.com/a)", "k");
    expect(ancoras(nos)[0].props.href).toBe("https://x.com/a");
    expect(textoDe(nos)).toBe("(ver https://x.com/a)");
  });

  it("o ) BALANCEADO dentro da URL fica dentro (caso Wikipedia)", () => {
    const url = "https://pt.wikipedia.org/wiki/Foo_(bar)";
    const nos = linkify(url, "k");
    expect(ancoras(nos)[0].props.href).toBe(url);
  });

  it("nao gera link quando sobra so o esquema", () => {
    // "https://" seco ou aparado ate o osso nao e link util.
    expect(ancoras(linkify("olha https:// ali", "k"))).toHaveLength(0);
    expect(textoDe(linkify("olha https:// ali", "k"))).toBe("olha https:// ali");
  });
});

describe("linkify -- contrato basico", () => {
  it("texto vazio devolve lista vazia", () => {
    expect(linkify("", "k")).toEqual([]);
  });

  it("texto sem URL volta inteiro, sem perder caractere", () => {
    const t = "nenhum link aqui, so texto.";
    expect(textoDe(linkify(t, "k"))).toBe(t);
  });

  it("as keys usam o prefixo recebido (evita colisao entre trechos)", () => {
    const nos = linkify("https://um.com e https://dois.com", "pref-");
    expect(ancoras(nos).map((a) => a.key)).toEqual(["pref-0", "pref-1"]);
  });
});
