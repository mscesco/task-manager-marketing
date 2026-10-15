// lib/baseClipboard.ts
// Copiar e colar várias células na Base (Spec 057, 15/10) -- a regra, pura.
//
// O formato é o do Excel e do Google Planilhas: linhas separadas por quebra,
// células por TAB. Copiar da Base e colar no Excel (e o contrário) funciona
// sem nada no meio.
//
// ⚠️ COLAR SÓ PREENCHE O QUE EXISTE: linhas a mais no que foi copiado, além da
// última linha da visão, são CONTADAS e ignoradas (a tela avisa). Criar linhas
// colando ficou para depois -- cada linha criada é uma ação do diário, e um
// Ctrl+Z não desfaria a colagem inteira.

import type { BaseCellValue, BaseColumn, BaseRow } from "./api";
import { interpretarDigitado, linksDaCelula, textoDaCelula, type Posicao } from "./baseTable";

export type Faixa = { linha0: number; linha1: number; coluna0: number; coluna1: number };

/** A faixa entre a âncora e a célula ativa, nas duas direções. */
export function faixaEntre(a: Posicao, b: Posicao): Faixa {
  return {
    linha0: Math.min(a.linha, b.linha),
    linha1: Math.max(a.linha, b.linha),
    coluna0: Math.min(a.coluna, b.coluna),
    coluna1: Math.max(a.coluna, b.coluna),
  };
}

export function dentro(f: Faixa | null, p: Posicao): boolean {
  return !!f && p.linha >= f.linha0 && p.linha <= f.linha1 && p.coluna >= f.coluna0 && p.coluna <= f.coluna1;
}

/** O texto que uma célula vira no papel de transferência. */
export function textoParaCopiar(
  coluna: BaseColumn,
  valor: BaseCellValue | undefined,
  nomeDePessoa: (id: string) => string
): string {
  if (valor === undefined || valor === null) return "";
  switch (coluna.type) {
    case "select":
    case "multi_select": {
      const ids = Array.isArray(valor) ? valor : [valor];
      return ids
        .map((id) => coluna.options.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join("; ");
    }
    case "person": {
      const ids = Array.isArray(valor) ? (valor as string[]) : [];
      return ids.map(nomeDePessoa).join("; ");
    }
    case "link":
      return linksDaCelula(valor)
        .map((l) => l.url)
        .join("; ");
    default:
      // ⚠️ Sem TAB nem quebra dentro da célula: elas partiriam a grade.
      return textoDaCelula(coluna, valor).replace(/[\t\r\n]+/g, " ");
  }
}

export function copiarFaixa(
  linhas: readonly BaseRow[],
  colunas: readonly BaseColumn[],
  f: Faixa,
  nomeDePessoa: (id: string) => string
): string {
  const out: string[] = [];
  for (let i = f.linha0; i <= f.linha1; i++) {
    const linha = linhas[i];
    if (!linha) continue;
    const celulas: string[] = [];
    for (let j = f.coluna0; j <= f.coluna1; j++) {
      const c = colunas[j];
      celulas.push(c ? textoParaCopiar(c, linha.values[c.id], nomeDePessoa) : "");
    }
    out.push(celulas.join("\t"));
  }
  return out.join("\n");
}

/** O texto colado como grade. Tira a quebra do fim (o Excel sempre põe). */
export function lerGrade(texto: string): string[][] {
  const linhas = texto.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return linhas.map((l) => l.split("\t"));
}

const SIM = new Set(["sim", "s", "x", "true", "verdadeiro", "1", "✓"]);
const NAO = new Set(["não", "nao", "n", "false", "falso", "0", ""]);

/** O valor a gravar para o texto colado, ou `undefined` = não serve. */
export function valorColado(
  coluna: BaseColumn,
  texto: string,
  pessoaPorNome: (nome: string) => string | null
): BaseCellValue | null | undefined {
  const t = texto.trim();
  if (!t) return null;
  const varios = t.split(/\s*;\s*/).filter(Boolean);
  switch (coluna.type) {
    case "checkbox": {
      const k = t.toLowerCase();
      return SIM.has(k) ? true : NAO.has(k) ? false : undefined;
    }
    case "select": {
      const o = coluna.options.find((x) => x.label.toLowerCase() === t.toLowerCase());
      return o ? o.id : undefined;
    }
    case "multi_select": {
      const ids = varios.map(
        (r) => coluna.options.find((x) => x.label.toLowerCase() === r.toLowerCase())?.id
      );
      return ids.every(Boolean) ? (ids as string[]) : undefined;
    }
    case "person": {
      const ids = varios.map(pessoaPorNome);
      return ids.every(Boolean) ? (ids as string[]) : undefined;
    }
    case "link": {
      const urls = varios.flatMap((v) => v.split(/\s+/));
      return urls.every((u) => /^https?:\/\/\S+$/i.test(u))
        ? urls.map((url) => ({ title: "", url }))
        : undefined;
    }
    default: {
      const r = interpretarDigitado(coluna, t);
      return r.ok ? r.valor : undefined;
    }
  }
}

export type Colagem = {
  cells: { row_id: string; column_id: string; value: BaseCellValue | null }[];
  /** Células com valor que não serve ao tipo da coluna. */
  invalidas: number;
  /** Células que caíram fora da tabela (linhas ou colunas a mais). */
  fora: number;
};

/** A colagem a partir de `inicio`: o que gravar, e o que ficou de fora. */
export function colarGrade(
  grade: string[][],
  linhas: readonly BaseRow[],
  colunas: readonly BaseColumn[],
  inicio: Posicao,
  pessoaPorNome: (nome: string) => string | null
): Colagem {
  const out: Colagem = { cells: [], invalidas: 0, fora: 0 };
  grade.forEach((celulas, i) => {
    const linha = linhas[inicio.linha + i];
    celulas.forEach((texto, j) => {
      const coluna = colunas[inicio.coluna + j];
      if (!linha || !coluna) {
        out.fora++;
        return;
      }
      const v = valorColado(coluna, texto, pessoaPorNome);
      if (v === undefined) {
        out.invalidas++;
        return;
      }
      out.cells.push({ row_id: linha.id, column_id: coluna.id, value: v });
    });
  });
  return out;
}
