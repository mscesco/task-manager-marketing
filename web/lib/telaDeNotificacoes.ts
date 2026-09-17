// lib/telaDeNotificacoes.ts
// As regras da tela `/notificacoes` (Spec 053, fatia F).
//
// ⚠️ `lib/` DECIDE (Spec 027): o que a URL guarda, que tipos o filtro oferece,
// como os avisos se agrupam por dia e o que o botao de marcar diz. O
// componente (`components/TelaDeNotificacoes.tsx`) so desenha.

import type { AppNotification, FiltroDeNotificacoes } from "./api";
import { type Agora, diaNoWorkspace } from "./prazo";

/** Avisos por pagina (Spec 053, §9.6). */
export const POR_PAGINA = 20;

/**
 * ⚠️ "silenciadas" e uma aba de VERDADE, e nao um filtro: o que esta
 * silenciado nao aparece nas outras duas (Spec 054, D5), entao ela e o
 * unico lugar onde esse aviso existe.
 */
export type Aba = "nao-lidas" | "todas" | "silenciadas";

/**
 * Uma opcao do filtro "tipo". Cada uma pode juntar varios tipos do backend:
 * "Prazo" e o prazo que MUDOU e o prazo que chega ou vence.
 */
export type OpcaoDeTipo = {
  readonly chave: string;
  readonly rotulo: string;
  readonly tipos: readonly string[];
};

export const OPCOES_DE_TIPO: readonly OpcaoDeTipo[] = [
  { chave: "comentarios", rotulo: "Comentários", tipos: ["TASK_COMMENTED"] },
  { chave: "mencoes", rotulo: "Menções", tipos: ["TASK_MENTIONED"] },
  { chave: "reacoes", rotulo: "Reações", tipos: ["TASK_COMMENT_REACTED"] },
  { chave: "designacoes", rotulo: "Designações", tipos: ["TASK_ASSIGNED"] },
  { chave: "colunas", rotulo: "Mudanças de coluna", tipos: ["TASK_COLUMN_CHANGED"] },
  {
    chave: "prazos",
    rotulo: "Prazo",
    tipos: ["TASK_DUE_CHANGED", "TASK_DUE_SOON", "TASK_OVERDUE"],
  },
  { chave: "descricoes", rotulo: "Descrição", tipos: ["TASK_DESCRIPTION_CHANGED"] },
  {
    chave: "arquivo",
    rotulo: "Arquivar e excluir",
    tipos: ["TASK_ARCHIVED", "TASK_UNARCHIVED", "TASK_DELETED"],
  },
  { chave: "seguidores", rotulo: "Seguidores", tipos: ["TASK_WATCH_ADDED", "TASK_WATCH_REMOVED"] },
  { chave: "acesso", rotulo: "Acesso", tipos: ["ACCESS_LOST"] },
];

const TIPO_POR_CHAVE = new Map(OPCOES_DE_TIPO.map((o) => [o.chave, o]));

/** O recorte "tarefa ou projeto". `nome` e so para o selo na tela. */
export type Alvo = {
  readonly kind: "task" | "project";
  readonly id: string;
  readonly nome: string;
};

export type EstadoDaTelaDeNotificacoes = {
  readonly aba: Aba;
  /** Chave de `OPCOES_DE_TIPO`, ou null = todos os tipos. */
  readonly tipo: string | null;
  readonly alvo: Alvo | null;
  readonly pagina: number;
};

export const ESTADO_INICIAL: EstadoDaTelaDeNotificacoes = {
  aba: "nao-lidas",
  tipo: null,
  alvo: null,
  pagina: 1,
};

/**
 * Le o estado da barra de enderecos (`?aba=todas&tipo=prazos&tarefa=<id>&nome=…&pagina=2`).
 *
 * ⚠️ VALOR DESCONHECIDO CAI NO PADRAO, pela mesma razao de `estadoDaTela.ts`:
 * a URL e digitavel, e um `?tipo=lixo` que virasse filtro daria uma lista vazia
 * sem explicacao.
 */
export function lerEstado(busca: string): EstadoDaTelaDeNotificacoes {
  const p = new URLSearchParams(busca);
  const abaCru = p.get("aba");
  const aba: Aba =
    abaCru === "todas" || abaCru === "silenciadas" ? abaCru : "nao-lidas";
  const tipoCru = p.get("tipo");
  const tipo = tipoCru && TIPO_POR_CHAVE.has(tipoCru) ? tipoCru : null;
  const nome = p.get("nome") ?? "";
  const tarefa = p.get("tarefa");
  const projeto = p.get("projeto");
  const alvo: Alvo | null = tarefa
    ? { kind: "task", id: tarefa, nome }
    : projeto
      ? { kind: "project", id: projeto, nome }
      : null;
  const paginaCru = Number.parseInt(p.get("pagina") ?? "", 10);
  const pagina = Number.isFinite(paginaCru) && paginaCru >= 1 ? paginaCru : 1;
  return { aba, tipo, alvo, pagina };
}

/** A query que representa o estado. Padrao nao entra: a URL limpa e a inicial. */
export function queryDoEstado(e: EstadoDaTelaDeNotificacoes): string {
  const p = new URLSearchParams();
  if (e.aba !== "nao-lidas") p.set("aba", e.aba);
  if (e.tipo) p.set("tipo", e.tipo);
  if (e.alvo) {
    p.set(e.alvo.kind === "task" ? "tarefa" : "projeto", e.alvo.id);
    if (e.alvo.nome) p.set("nome", e.alvo.nome);
  }
  if (e.pagina > 1) p.set("pagina", String(e.pagina));
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** O que vai para a API -- a listagem E o "marcar estas" usam o mesmo (D25).
 *
 * ⚠️ `muted` SAI DA ABA, e entra aqui junto com os filtros: e o que faz o
 * botao de marcar tocar exatamente o que a aba mostrou (Spec 054, D14). Na
 * aba "Silenciadas" ele marca so silenciadas; nas outras, nunca as toca.
 */
export function filtroDaApi(e: EstadoDaTelaDeNotificacoes): FiltroDeNotificacoes {
  return {
    types: e.tipo ? TIPO_POR_CHAVE.get(e.tipo)?.tipos ?? [] : [],
    task_id: e.alvo?.kind === "task" ? e.alvo.id : null,
    project_id: e.alvo?.kind === "project" ? e.alvo.id : null,
    muted: e.aba === "silenciadas",
  };
}

/** Ha filtro alem da aba? Decide o rotulo do botao e o texto do vazio. */
export function temFiltro(e: EstadoDaTelaDeNotificacoes): boolean {
  return e.tipo !== null || e.alvo !== null;
}

/**
 * O que o "marcar" manda. Sem recorte de tipo ou tarefa ele vai VAZIO -- e o
 * "marcar todas" de sempre, o mesmo do sino.
 *
 * ⚠️ MENOS O `muted`, QUE NUNCA PODE FALTAR (Spec 054, D14). Na aba
 * "Silenciadas" sem nenhum filtro, um objeto vazio faria o botao marcar as
 * notificacoes das OUTRAS abas -- as que a pessoa nem estava vendo -- e deixar
 * intactas as que ela tinha na frente.
 */
export function filtroDeMarcar(e: EstadoDaTelaDeNotificacoes): FiltroDeNotificacoes {
  if (temFiltro(e)) return filtroDaApi(e);
  return e.aba === "silenciadas" ? filtroDaApi(e) : {};
}

/**
 * O rotulo do botao de marcar (D25). Com filtro, diz QUANTAS -- e marca so
 * essas. `naoLidasNoFiltro` e o total de nao lidas do recorte.
 */
export function rotuloDoBotaoMarcar(filtrado: boolean, naoLidasNoFiltro: number): string {
  if (!filtrado) return "Marcar todas como lidas";
  return naoLidasNoFiltro === 1
    ? "Marcar esta 1 como lida"
    : `Marcar estas ${naoLidasNoFiltro} como lidas`;
}

export type GrupoDoDia = { readonly rotulo: string; readonly itens: AppNotification[] };

/** O dia anterior de um `YYYY-MM-DD`, pela aritmetica de datas UTC (sem fuso). */
function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Agrupa por dia, na ordem em que os avisos vieram (ultima mudanca primeiro).
 * Rotulos: "Hoje", "Ontem", ou `DD/MM` (com o ano quando nao e o atual).
 *
 * ⚠️ O DIA E O DA ULTIMA MUDANCA (`updated_at`), e no FUSO DO WORKSPACE: um
 * aviso das 23h de Brasilia nao pode aparecer em "amanha" num navegador em UTC.
 */
export function agruparPorDia(itens: AppNotification[], agora: Agora): GrupoDoDia[] {
  const ontem = diaAnterior(agora.data);
  const grupos: GrupoDoDia[] = [];
  for (const n of itens) {
    const dia = diaNoWorkspace(n.updated_at ?? n.created_at);
    const rotulo =
      dia === agora.data
        ? "Hoje"
        : dia === ontem
          ? "Ontem"
          : dia.slice(0, 4) === agora.data.slice(0, 4)
            ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
            : `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(n);
    else grupos.push({ rotulo, itens: [n] });
  }
  return grupos;
}
