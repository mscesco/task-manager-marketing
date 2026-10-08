"use client";
// components/bases/useGravarCelula.ts
// Gravar UMA célula da Base -- a tabela, o quadro e o calendário gravam pelo
// mesmo caminho (Spec 056, fatias E e F).
//
// ⚠️ OTIMISTA: a tela muda na hora e VOLTA se o servidor recusar, com o
// motivo num aviso. A linha que o servidor devolve substitui a local -- é ela
// que tem a `version` nova. Três cópias disto seriam três jeitos de divergir.
//
// ⚠️ DUAS EDIÇÕES NA MESMA LINHA EM VOO (Tab e digitar de novo; revisão de
// 08/10): a resposta mais velha pode chegar por último. Por isso ela só
// substitui a linha se a `version` não andar para trás, e o erro desfaz SÓ a
// própria célula -- voltar a linha inteira apagava a outra edição, que deu
// certo.

import { useCallback } from "react";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  updateBaseCells,
  type BaseCellValue,
  type BaseColumn,
  type BaseRow,
} from "@/lib/api";
import { acompanhar } from "@/lib/gravacoesDaBase";

export function useGravarCelula(
  baseId: string,
  onLinhas: (atualizar: (l: BaseRow[]) => BaseRow[]) => void
) {
  const avisar = useAvisar();
  return useCallback(
    async (linha: BaseRow, coluna: BaseColumn, valor: BaseCellValue | null) => {
      const antes = linha.values[coluna.id];
      if (igual(antes, valor)) return;
      onLinhas((ls) => ls.map((l) => (l.id === linha.id ? comCelula(l, coluna.id, valor) : l)));
      try {
        const [nova] = await acompanhar(
          baseId,
          updateBaseCells(baseId, [{ row_id: linha.id, column_id: coluna.id, value: valor }])
        );
        onLinhas((ls) => ls.map((l) => (l.id === nova.id && nova.version >= l.version ? nova : l)));
      } catch (e) {
        onLinhas((ls) =>
          ls.map((l) => (l.id === linha.id ? comCelula(l, coluna.id, antes ?? null) : l))
        );
        avisar((e as ApiError).message || "Não consegui salvar a célula.");
      }
    },
    [baseId, onLinhas, avisar]
  );
}

function comCelula(l: BaseRow, colunaId: string, valor: BaseCellValue | null): BaseRow {
  const values = { ...l.values };
  if (valor === null) delete values[colunaId];
  else values[colunaId] = valor;
  return { ...l, values };
}

export function igual(a: BaseCellValue | undefined, b: BaseCellValue | null): boolean {
  if (a === undefined) return b === null;
  return JSON.stringify(a) === JSON.stringify(b);
}
