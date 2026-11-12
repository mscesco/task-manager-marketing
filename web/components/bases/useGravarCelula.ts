"use client";
// Grava uma célula da Base (tabela, quadro e calendário usam este caminho).
// Otimista: a tela muda na hora e volta se o servidor recusar. A linha devolvida só
// substitui a local se a `version` não andar para trás, e o erro desfaz só a própria célula.

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
        // Só volta se a linha ainda é a que esta edição viu: uma edição
        // posterior que já deu certo trouxe `version` nova, e desfazê-la
        // deixaria a tela com um valor que não existe no banco.
        onLinhas((ls) =>
          ls.map((l) =>
            l.id === linha.id && l.version === linha.version
              ? comCelula(l, coluna.id, antes ?? null)
              : l
          )
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
