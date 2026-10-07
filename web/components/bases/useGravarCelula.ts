"use client";
// components/bases/useGravarCelula.ts
// Gravar UMA célula da Base -- a tabela, o quadro e o calendário gravam pelo
// mesmo caminho (Spec 056, fatias E e F).
//
// ⚠️ OTIMISTA: a tela muda na hora e VOLTA se o servidor recusar, com o
// motivo num aviso. A linha que o servidor devolve substitui a local -- é ela
// que tem a `version` nova. Três cópias disto seriam três jeitos de divergir.

import { useCallback } from "react";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  updateBaseCells,
  type BaseCellValue,
  type BaseColumn,
  type BaseRow,
} from "@/lib/api";

export function useGravarCelula(
  baseId: string,
  onLinhas: (atualizar: (l: BaseRow[]) => BaseRow[]) => void
) {
  const avisar = useAvisar();
  return useCallback(
    async (linha: BaseRow, coluna: BaseColumn, valor: BaseCellValue | null) => {
      const antes = linha.values[coluna.id];
      if (igual(antes, valor)) return;
      const comValor = (l: BaseRow): BaseRow => {
        const values = { ...l.values };
        if (valor === null) delete values[coluna.id];
        else values[coluna.id] = valor;
        return { ...l, values };
      };
      onLinhas((ls) => ls.map((l) => (l.id === linha.id ? comValor(l) : l)));
      try {
        const [nova] = await updateBaseCells(baseId, [
          { row_id: linha.id, column_id: coluna.id, value: valor },
        ]);
        onLinhas((ls) => ls.map((l) => (l.id === nova.id ? nova : l)));
      } catch (e) {
        onLinhas((ls) => ls.map((l) => (l.id === linha.id ? linha : l)));
        avisar((e as ApiError).message || "Não consegui salvar a célula.");
      }
    },
    [baseId, onLinhas, avisar]
  );
}

export function igual(a: BaseCellValue | undefined, b: BaseCellValue | null): boolean {
  if (a === undefined) return b === null;
  return JSON.stringify(a) === JSON.stringify(b);
}
