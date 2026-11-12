// Regras da fila de Solicitações que não são desenho.

import type { Batch } from "./api";
import { agoraNoWorkspace, diaNoWorkspace } from "./prazo";

/**
 * Quando o envio chegou, como uma caixa de entrada mostra: a hora se foi hoje,
 * "Ontem", e a data curta antes disso. O dia é o do workspace, não o da máquina.
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
 * O cabeçalho de dia da lista: "Hoje", "Ontem", e a data
 * curta antes disso. O mesmo dia de Brasília de `quandoChegou`.
 */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const hoje = agoraNoWorkspace(agora).data;
  const dia = diaNoWorkspace(iso);
  if (dia === hoje) return "Hoje";
  const ontem = agoraNoWorkspace(new Date(agora.getTime() - 86_400_000)).data;
  if (dia === ontem) return "Ontem";
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

/**
 * O dia de um instante, `DD/MM/AAAA`, no fuso do workspace -- e não no da
 * máquina, onde um pedido das 22h de Brasília apareceria no dia seguinte.
 */
export function diaDoEnvio(iso: string): string {
  const [ano, mes, dia] = diaNoWorkspace(iso).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Qual demanda o painel abre primeiro: a primeira ainda PENDENTE (é a que
 * pede decisão), senão a primeira do envio.
 */
export function demandaInicial(envio: Batch): string | null {
  return (envio.items.find((i) => i.status === "PENDING") ?? envio.items[0])?.id ?? null;
}
