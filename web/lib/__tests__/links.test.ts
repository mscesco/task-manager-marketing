// Spec 052, fatia B -- as regras do editor de links.
import { describe, expect, it } from "vitest";
import {
  completarEndereco,
  errosDosLinks,
  linhaVazia,
  linksMudaram,
  MAX_LINKS,
  moverLink,
  paraEnvio,
  passaDoTeto,
  rascunhoDe,
  temErro,
  type RascunhoLink,
} from "@/lib/links";

function linha(title: string, url: string): RascunhoLink {
  return { ...linhaVazia(), title, url };
}

describe("completarEndereco", () => {
  it("⭐ põe https:// quando falta -- o caso de colar do Drive", () => {
    expect(completarEndereco("drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(completarEndereco("  voleibrasil.media/ ")).toBe("https://voleibrasil.media/");
  });

  it("deixa como está quando já tem http ou https", () => {
    expect(completarEndereco("http://a.com")).toBe("http://a.com");
    expect(completarEndereco("https://a.com")).toBe("https://a.com");
  });

  it("⚠️ NÃO põe https:// na frente de outro esquema -- javascript: fica e é recusado", () => {
    expect(completarEndereco("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(completarEndereco("ftp://x")).toBe("ftp://x");
  });

  it("vazio continua vazio", () => {
    expect(completarEndereco("   ")).toBe("");
  });
});

describe("errosDosLinks", () => {
  it("linha totalmente vazia não é erro -- ela é descartada", () => {
    expect(temErro(errosDosLinks([linha("", "")]))).toBe(false);
  });

  it("nome sem endereço, e endereço sem nome, apontam o campo certo", () => {
    const [a, b] = errosDosLinks([linha("Pasta", ""), linha("", "drive.google.com")]);
    expect(a.url).toBeTruthy();
    expect(a.title).toBeUndefined();
    expect(b.title).toBeTruthy();
    expect(b.url).toBeUndefined();
  });

  it("⚠️ endereço com outro esquema é erro", () => {
    const [e] = errosDosLinks([linha("X", "javascript:alert(1)")]);
    expect(e.url).toBeTruthy();
  });

  it("link completo não tem erro", () => {
    expect(temErro(errosDosLinks([linha("Pasta", "drive.google.com/x")]))).toBe(false);
  });
});

describe("paraEnvio e passaDoTeto", () => {
  it("apara, completa o https:// e tira as linhas vazias", () => {
    expect(
      paraEnvio([linha(" Pasta ", "drive.google.com/x"), linha("", ""), linha("B", "https://b.com")]),
    ).toEqual([
      { title: "Pasta", url: "https://drive.google.com/x" },
      { title: "B", url: "https://b.com" },
    ]);
  });

  it("o teto conta só o que vai ser enviado", () => {
    const cheia = Array.from({ length: MAX_LINKS }, (_, i) => linha(`L${i}`, `https://a.com/${i}`));
    expect(passaDoTeto([...cheia, linha("", "")])).toBe(false);
    expect(passaDoTeto([...cheia, linha("Mais um", "https://a.com/x")])).toBe(true);
  });
});

describe("linksMudaram", () => {
  const salvos = [
    { id: "1", title: "A", url: "https://a.com" },
    { id: "2", title: "B", url: "https://b.com" },
  ];

  it("a mesma lista, reaberta, não mudou", () => {
    expect(linksMudaram(salvos, rascunhoDe(salvos))).toBe(false);
  });

  it("⚠️ linha vazia a mais, ou espaço no fim do nome, não é mudança", () => {
    const r = rascunhoDe(salvos);
    r[0] = { ...r[0], title: "A " };
    expect(linksMudaram(salvos, [...r, linhaVazia()])).toBe(false);
  });

  it("renomear, reordenar e remover são mudança", () => {
    const r = rascunhoDe(salvos);
    expect(linksMudaram(salvos, [{ ...r[0], title: "A2" }, r[1]])).toBe(true);
    expect(linksMudaram(salvos, [r[1], r[0]])).toBe(true);
    expect(linksMudaram(salvos, [r[0]])).toBe(true);
  });
});

describe("moverLink", () => {
  it("sobe e desce uma posição", () => {
    expect(moverLink(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moverLink(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("nas pontas não faz nada", () => {
    expect(moverLink(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moverLink(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
