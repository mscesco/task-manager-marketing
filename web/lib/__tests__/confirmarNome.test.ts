// lib/confirmarNome -- "digite o nome para confirmar", a regra única de excluir
// quadro e excluir base (revisão de 07/10: eram duas cópias, e a da Base
// aceitava nome vazio).
import { describe, expect, it } from "vitest";
import { nomeConfere } from "@/lib/confirmarNome";
import { nomeConfere as daBase } from "@/lib/baseTable";
import { nomeConfere as doQuadro } from "@/lib/seletorDeQuadro";

describe("nomeConfere", () => {
  it("confere com espaço nas pontas, e maiúscula conta", () => {
    expect(nomeConfere("  Calendário  ", "Calendário")).toBe(true);
    expect(nomeConfere("calendário", "Calendário")).toBe(false);
  });

  it("⚠️ nome vazio nunca confere -- nem quando o item 'tem' nome vazio", () => {
    expect(nomeConfere("", "")).toBe(false);
    expect(nomeConfere("   ", " ")).toBe(false);
  });

  it("a Base e o quadro usam a MESMA regra (era aqui que tinham divergido)", () => {
    expect(daBase).toBe(nomeConfere);
    expect(doQuadro).toBe(nomeConfere);
  });
});
