// lib/filaDeSolicitacoes.ts
// A regra da fila de Solicitações (15/10) que não é desenho.

import type { Batch } from "./api";
import { agoraNoWorkspace, diaNoWorkspace } from "./prazo";

/**
 * Quando o envio chegou, como uma caixa de entrada mostra: a hora se foi hoje,
 * "Ontem", e a data curta antes disso.
 *
 * ⚠️ O DIA É O DE BRASÍLIA (`diaNoWorkspace`), e não o da máquina -- a regra
 * 0.1 do `web/AGENTS.md`: um envio das 23h viraria "amanhã" num runner em UTC.
 */
export function quandoChegou(iso: string, agora: Date = new Date()): string {
  const hoje = agoraNoWorkspace(agora).data;
  const dia = diaNoWorkspace(iso);
  if (dia === hoje) return agoraNoWorkspace(new Date(iso)).hora;
  const ontem = agoraNoWorkspace(new Date(agora.getTime() - 86_400_000)).data;
  if (dia === ontem) return "Ontem";
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * Qual demanda o painel abre primeiro: a primeira ainda PENDENTE (é a que
 * pede decisão), senão a primeira do envio.
 */
export function demandaInicial(envio: Batch): string | null {
  return (envio.items.find((i) => i.status === "PENDING") ?? envio.items[0])?.id ?? null;
}
