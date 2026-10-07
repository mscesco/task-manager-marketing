// lib/baseDesfazer.ts
// O Ctrl+Z da Base na tela (Spec 056, fatia H, §9). Regra pura, testada em
// `lib/__tests__/baseDesfazer.test.ts`.
//
// ⚠️⚠️ CTRL+Z DENTRO DE UM CAMPO DE TEXTO DESFAZ O TEXTO, não a base (§9.4).
// A pilha da base só responde com o foco FORA de um campo -- numa célula da
// grade, num botão, no corpo da página. Sem isto, apagar uma letra com Ctrl+Z
// desfaria a última gravação de alguém.

export type AcaoDeDesfazer = "undo" | "redo";

export type TeclaPressionada = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** O alvo é um campo que edita texto por conta própria? */
  emCampoDeTexto: boolean;
};

/** Qual ação o atalho pede -- ou `null`, e a tecla segue seu caminho.
 *
 *  Desfazer: Ctrl+Z (Cmd+Z no Mac).
 *  Refazer:  Ctrl+Shift+Z (Cmd+Shift+Z) ou Ctrl+Y -- os dois que as pessoas
 *            trazem de outros programas. */
export function atalhoDeDesfazer(t: TeclaPressionada): AcaoDeDesfazer | null {
  if (t.emCampoDeTexto || t.altKey) return null;
  if (!(t.ctrlKey || t.metaKey)) return null;
  const k = t.key.toLowerCase();
  if (k === "z") return t.shiftKey ? "redo" : "undo";
  if (k === "y" && !t.shiftKey) return "redo";
  return null;
}

/** O alvo de um evento edita texto sozinho? (`input` de texto, `textarea`,
 *  `select`, ou um editor rico com `contenteditable`). Checkbox e botão NÃO:
 *  neles o Ctrl+Z não tem o que desfazer, e a base é que deve responder. */
export function editaTextoSozinho(alvo: {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
} | null): boolean {
  if (!alvo) return false;
  if (alvo.isContentEditable) return true;
  const tag = (alvo.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const naoTexto = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"];
  return !naoTexto.includes((alvo.type ?? "text").toLowerCase());
}

const NOME_DA_ACAO: Record<string, string> = {
  "cell.update": "a edição de célula",
  "row.create": "a linha criada",
  "row.delete": "a linha apagada",
  "column.create": "a coluna criada",
  "column.update": "a mudança na coluna",
  "column.retype": "a troca de tipo",
  "column.delete": "a coluna apagada",
  "option.delete": "a opção apagada",
  "view.create": "a visão criada",
  "view.update": "a mudança na visão",
  "view.delete": "a visão apagada",
};

export type ResultadoDoDesfazer = { applied: boolean; conflict: boolean; kind: string | null };

/** O aviso depois de um Ctrl+Z ou de um refazer. Sempre diz o que aconteceu --
 *  inclusive "nada", para o atalho não parecer quebrado. */
export function mensagemDoDesfazer(acao: AcaoDeDesfazer, r: ResultadoDoDesfazer): string {
  const oQue = (r.kind && NOME_DA_ACAO[r.kind]) || "a última ação";
  if (r.applied) return acao === "undo" ? `Desfeito: ${oQue}.` : `Refeito: ${oQue}.`;
  if (r.conflict) {
    // D12: recusado sem sobrescrever. A entrada saiu da pilha -- o próximo
    // Ctrl+Z tenta a anterior, e o aviso diz isso.
    return acao === "undo"
      ? `Não dá para desfazer ${oQue}: alguém mudou isso depois. O próximo Ctrl+Z tenta a ação anterior.`
      : `Não dá para refazer ${oQue}: alguém mudou isso depois.`;
  }
  return acao === "undo"
    ? "Nada para desfazer nesta base (o Ctrl+Z vale para o que você fez nas últimas 24 horas)."
    : "Nada para refazer.";
}
