import { describe, expect, it } from "vitest";
import { atalhoDeDesfazer, editaTextoSozinho, mensagemDoDesfazer } from "@/lib/baseDesfazer";

const tecla = (over: Partial<Parameters<typeof atalhoDeDesfazer>[0]>) => ({
  key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, emCampoDeTexto: false,
  ...over,
});

describe("atalhoDeDesfazer", () => {
  it("Ctrl+Z e Cmd+Z desfazem", () => {
    expect(atalhoDeDesfazer(tecla({}))).toBe("undo");
    expect(atalhoDeDesfazer(tecla({ ctrlKey: false, metaKey: true }))).toBe("undo");
    expect(atalhoDeDesfazer(tecla({ key: "Z" }))).toBe("undo");
  });
  it("Ctrl+Shift+Z e Ctrl+Y refazem", () => {
    expect(atalhoDeDesfazer(tecla({ shiftKey: true, key: "Z" }))).toBe("redo");
    expect(atalhoDeDesfazer(tecla({ key: "y" }))).toBe("redo");
  });
  it("⚠️ dentro de um campo de texto, o Ctrl+Z é do texto (§9.4)", () => {
    expect(atalhoDeDesfazer(tecla({ emCampoDeTexto: true }))).toBeNull();
  });
  it("sem Ctrl/Cmd, ou com Alt, não é atalho", () => {
    expect(atalhoDeDesfazer(tecla({ ctrlKey: false }))).toBeNull();
    expect(atalhoDeDesfazer(tecla({ altKey: true }))).toBeNull();
    expect(atalhoDeDesfazer(tecla({ key: "x" }))).toBeNull();
  });
});

describe("editaTextoSozinho", () => {
  it("campo de texto, textarea, select e editor rico, sim", () => {
    expect(editaTextoSozinho({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(editaTextoSozinho({ tagName: "INPUT", type: "date" })).toBe(true);
    expect(editaTextoSozinho({ tagName: "TEXTAREA" })).toBe(true);
    expect(editaTextoSozinho({ tagName: "SELECT" })).toBe(true);
    expect(editaTextoSozinho({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("célula da grade, checkbox e botão, não -- a base responde", () => {
    expect(editaTextoSozinho({ tagName: "TD" })).toBe(false);
    expect(editaTextoSozinho({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(editaTextoSozinho({ tagName: "BUTTON" })).toBe(false);
    expect(editaTextoSozinho(null)).toBe(false);
  });
});

describe("mensagemDoDesfazer", () => {
  it("diz o que foi desfeito", () => {
    expect(mensagemDoDesfazer("undo", { applied: true, conflict: false, kind: "column.retype" }))
      .toBe("Desfeito: a troca de tipo.");
    expect(mensagemDoDesfazer("redo", { applied: true, conflict: false, kind: "row.delete" }))
      .toBe("Refeito: a linha apagada.");
  });
  it("⚠️ conflito (D12) diz por quê, e que o próximo Ctrl+Z tenta a anterior", () => {
    const m = mensagemDoDesfazer("undo", { applied: false, conflict: true, kind: "cell.update" });
    expect(m).toMatch(/alguém mudou isso depois/);
    expect(m).toMatch(/próximo Ctrl\+Z/);
  });
  it("nada a desfazer também é dito -- o atalho não pode parecer quebrado", () => {
    expect(mensagemDoDesfazer("undo", { applied: false, conflict: false, kind: null }))
      .toMatch(/Nada para desfazer/);
  });
  it("kind desconhecido não vira texto cru", () => {
    expect(mensagemDoDesfazer("undo", { applied: true, conflict: false, kind: "algo.novo" }))
      .toBe("Desfeito: a última ação.");
  });
});
