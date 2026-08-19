// lib/status.ts
// Os 8 status do backend (enum task_status) + rotulo PT e cor da coluna.
// Decisao da Camila (E9): mostrar todos no Kanban. Se um dia quiser
// colapsar, e so reduzir esta lista / mapear aqui -- a tela le daqui.
// Spec 026: EXTERNAL_APPROVAL (aprovacao de fora do time) entra entre a
// aprovacao interna e o concluido; IN_REVIEW passou a "Aprovacao Interna"
// para o par de rotulos nao ficar ambiguo ("Em Aprovacao" x "Externa").
//
// Spec 031 (C1a) -- COR VIROU TOKEN.
//
// Nenhuma cor mora mais neste arquivo. Cada familia tem DOIS tokens,
// declarados nos dois temas em app/globals.css:
//
//   --*-dot    cromatico, para o que NAO e texto (bolinha, borda de coluna,
//              outline de drop, borda esquerda de linha). Valor identico ao
//              hex de antes -> aparencia desses elementos nao mudou.
//   --*-text   stop escuro (claro no tema escuro). Texto sobre --surface,
//              e tambem FUNDO sob --on-chroma no Badge tone="solid".
//
// Motivo: os hex antigos eram fixos, nao invertiam no tema escuro, e como
// TEXTO reprovavam WCAG AA no tema claro -- "Alta" (#f59e0b) dava 2.15 sobre
// branco, e o branco do tone="solid" dava 2.15 sobre ele. Ver Spec 031 §2.2.
//
// Devolver `var(--x)` em vez de hex mantem este modulo PURO (Spec 027): a
// funcao nao precisa saber qual tema esta ligado, quem resolve e o CSS, antes
// da primeira pintura, pelo script bloqueante do layout.tsx.
//
// ⚠️ NAO concatenar string em cima destes valores. `PRIORITY_COLOR[p] + "1a"`
// produzia `var(--x)1a`, declaracao invalida que o browser descarta -- era o
// que ja acontecia no Badge e deixava 5 badges sem fundo. Ver Badge.tsx.

// ⚠️ Spec 038, fatia B: a regra de "atrasou?" mora em `lib/prazo.ts`, e este
// arquivo a CONSOME. Ela saiu daqui de proposito -- atraso com hora e uma
// pergunta sobre um INSTANTE, e tudo neste modulo raciocina em DIAS.
import { agoraNoWorkspace, estaAtrasada } from "@/lib/prazo";

export const STATUSES = [
  { key: "BACKLOG", label: "Backlog", color: "var(--status-backlog-dot)" },
  { key: "PLANNED", label: "Planejado", color: "var(--status-planned-dot)" },
  { key: "IN_PROGRESS", label: "Em Andamento", color: "var(--status-progress-dot)" },
  { key: "IN_REVIEW", label: "Aprovação Interna", color: "var(--status-review-dot)" },
  { key: "EXTERNAL_APPROVAL", label: "Aprovação Externa", color: "var(--status-external-dot)" },
  { key: "COMPLETED", label: "Concluído", color: "var(--status-done-dot)" },
  { key: "CANCELLED", label: "Cancelado", color: "var(--status-cancel-dot)" },
  { key: "BLOCKED", label: "Bloqueado", color: "var(--status-blocked-dot)" },
] as const;

// Cor de TEXTO do status -- e tambem a cor de FUNDO quando o texto por cima
// e --on-chroma (Badge tone="solid"/"outline"). Contraste e simetrico, entao
// o mesmo valor cobre os dois usos. Chave = a mesma de STATUSES.
export const STATUS_TEXT: Record<string, string> = {
  BACKLOG: "var(--status-backlog-text)",
  PLANNED: "var(--status-planned-text)",
  IN_PROGRESS: "var(--status-progress-text)",
  IN_REVIEW: "var(--status-review-text)",
  EXTERNAL_APPROVAL: "var(--status-external-text)",
  COMPLETED: "var(--status-done-text)",
  CANCELLED: "var(--status-cancel-text)",
  BLOCKED: "var(--status-blocked-text)",
};

export const PRIORITY_LABEL: Record<string, string> = {
  LOW: "Baixa",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

// ⚠️ O NOME continua PRIORITY_COLOR de proposito: 3 arquivos importam. Trocar
// o nome junto com o valor faria a fatia tocar arquivo que nao precisa mudar.
// O que mudou e o VALOR -- agora e o token de TEXTO, que e como ele sempre foi
// usado (Badge color=, style color=).
export const PRIORITY_COLOR: Record<string, string> = {
  LOW: "var(--prio-low-text)",
  MEDIUM: "var(--prio-medium-text)",
  HIGH: "var(--prio-high-text)",
  URGENT: "var(--prio-urgent-text)",
};

// Cromatico da prioridade. Ainda sem call-site -- entra na C2, quando o selo
// de prioridade vira bolinha + rotulo (Spec 031 D3). Exportado agora para o
// par nascer junto e ninguem precisar reabrir globals.css depois.
export const PRIORITY_DOT: Record<string, string> = {
  LOW: "var(--prio-low-dot)",
  MEDIUM: "var(--prio-medium-dot)",
  HIGH: "var(--prio-high-dot)",
  URGENT: "var(--prio-urgent-dot)",
};

// Status que "Minhas tarefas" mostra ao ABRIR (pedido da Camila, 29/07).
//
// COMPLETED fica de fora: a tela responde "o que eu tenho pra fazer", e o que
// ja foi feito nao e resposta pra isso. Antes, toda visita comecava com a
// pessoa desmarcando "Concluido" na mao.
//
// CANCELLED continua LIGADO de proposito, mesmo sendo terminal: cancelamento
// costuma ser noticia ("por que isso foi cancelado?"), enquanto conclusao e
// rotina. Se incomodar, e so incluir "CANCELLED" no Set abaixo.
//
// O filtro segue manual: "Todos" traz tudo de volta em um clique.
const STATUS_OCULTOS_POR_PADRAO = new Set<string>(["COMPLETED"]);

export function statusPadraoMinhasTarefas(): string[] {
  return STATUSES.map((s) => s.key).filter(
    (k) => !STATUS_OCULTOS_POR_PADRAO.has(k)
  );
}

// Cor de prazo (Spec 023): laranja perto de vencer, vermelho atrasado.
// null = sem alerta (sem prazo, arquivada, ou status terminal).
export type DeadlineTone = "overdue" | "soon" | null;

// Usado como TEXTO no card e no detalhe, e como borda esquerda de 3px em
// minhas-tarefas. Token de texto nos dois casos: a borda fica levemente mais
// escura que antes, e continua cromatica.
export const DEADLINE_COLOR: Record<"overdue" | "soon", string> = {
  overdue: "var(--due-overdue-text)",
  soon: "var(--due-soon-text)",
};

// Cromatico do prazo. Sem call-site hoje -- mesmo motivo do PRIORITY_DOT.
export const DEADLINE_DOT: Record<"overdue" | "soon", string> = {
  overdue: "var(--due-overdue-dot)",
  soon: "var(--due-soon-dot)",
};

// ===========================================================================
// SELO "PARADA HA X DIAS" (Spec 031, C2 / D6)
// ===========================================================================
//
// ⚠️⚠️ ESTE BLOCO TEM DATA DE DEMOLICAO (Spec 036, fatia 4c / ADR 0040).
//
// `STATUS_QUE_PARAM`, `diasParado`, `deadlineTone` e
// `statusPadraoMinhasTarefas` reimplementam a mao o que `column.semantic` e
// `column.notify_deadline` ja dizem. Eles funcionam para os 8 status legados e
// SO para eles: coluna criada por gente nasce com `legacy_status` NULL e cai
// fora de todos os conjuntos aqui, em silencio.
//
// **As versoes por COLUNA vivem em `lib/coluna.ts`** e sao as que devem ser
// usadas em codigo novo. Este bloco fica ate a fatia 4c migrar os quatro
// call-sites (`TaskCard`, `TaskDetail`, `minhas-tarefas`, `Board`), porque
// troca-los agora deixaria o `tsc` vermelho entre fatias -- entrega parcial
// que quebra o build.
//
// ⚠️ `lib/__tests__/paridadeColuna.test.ts` compara as DUAS implementacoes,
// caso a caso, contra as 8 colunas padrao. **Ele morre junto com este bloco**;
// enquanto os dois existirem, ele e o que prova que nada mudou.
//
// ⚠️ LEIA ANTES DE CONFIAR NO NUMERO. Isto mede tempo desde o ultimo
// `updated_at`, e `updated_at` muda com STATUS, TITULO e PRAZO -- NAO muda com
// comentario nem com designacao de responsavel. Uma tarefa sendo discutida
// ativamente nos comentarios aparece como "parada". A imprecisao foi aceita
// (D6): o sinal ainda vale mais que a ausencia dele, e "Em Andamento: 26" vira
// "4 andando, 22 encalhadas". Mas o rotulo nao promete mais do que isso.
//
// Nao existe trigger de updated_at no banco -- quem escreve e o ORM.
export const DIAS_PARA_PARADA = 7;

// Status em que parar E noticia. BACKLOG fica de fora: parado la e o estado
// normal, nao abandono. BLOCKED tambem fica de fora (D6): bloqueio e estado
// declarado, alguem ja sabe. Aprovacao e o caso mais bem mirado dos tres --
// e onde some sem ninguem declarar nada.
const STATUS_QUE_PARAM = new Set<string>([
  "IN_PROGRESS",
  "IN_REVIEW",
  "EXTERNAL_APPROVAL",
]);

/**
 * Dias inteiros desde a ultima mudanca, ou `null` quando nao ha selo.
 *
 * `null` (e nao 0) para "nao se aplica": arquivada, status fora da lista, ou
 * abaixo do limiar. Quem chama testa `!= null`, sem confundir com "0 dias".
 *
 * Compara em DATA local (meia-noite), igual ao `deadlineDays` -- pelo mesmo
 * motivo registrado la. `updated_at` vem como timestamp ISO do backend.
 */
export function diasParado(
  updatedAt: string | null | undefined,
  status: string,
  isArchived: boolean
): number | null {
  if (!updatedAt || isArchived) return null;
  if (!STATUS_QUE_PARAM.has(status)) return null;
  const t = new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return null; // data suja nao vira selo
  const desde = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const dias = Math.round((hoje.getTime() - desde.getTime()) / 86400000);
  if (dias < DIAS_PARA_PARADA) return null;
  return dias;
}

/**
 * ⚠️ `plural` SAIU DAQUI na fatia 4a (ADR 0040). Mora em `lib/plural.ts`.
 *
 * Ela nunca teve relacao com status: `lib/exclusao.ts` a importava daqui so
 * porque foi aqui que ela nasceu -- evidencia, medida na
 * sondagem da fatia 4 (absorvida no `plan.md` em 13/08), de que este modulo
 * tinha virado gaveta. Importe de `@/lib/plural`.
 */

/** Rotulo do selo. So chamar quando `diasParado` != null. */
export function paradaLabel(dias: number): string {
  return `Parada há ${dias} d`;
}

// Compara em DATA, nao em instante -- o prazo e um dia, nao uma hora.
// ⚠️ O FUSO E O DO WORKSPACE, EXPLICITO. Este comentario dizia "assume o fuso do
// browser (equipe no Brasil, casa com o backend)" -- e "casa por acidente
// geografico" deixou de bastar quando o atraso com hora entrou. Ver o corpo.
//
// ⚠️ EXPORTADA NA FATIA 4a (ADR 0040) para que `lib/coluna.ts` reuse a MESMA
// aritmetica de data. Duplicar o calculo la seria criar duas fontes de verdade
// para "quantos dias faltam" -- e as duas divergiriam no primeiro ajuste de
// fuso. Quando a fatia 4c apagar as funcoes por status deste arquivo, esta
// funcao MUDA DE CASA para `lib/coluna.ts`; ela nao morre junto.
export function deadlineDays(dueDate: string): number {
  // ⚠️ NO FUSO DO WORKSPACE, E NAO NO DA MAQUINA (corrigido em 18/08, depois de
  // o CI reprovar). A versao anterior usava a meia-noite LOCAL, e quando
  // `estaAtrasada` passou a decidir em `America/Sao_Paulo` isto virou DUAS
  // FONTES DE VERDADE para "que dia e hoje" -- exatamente o que o comentario
  // antigo desta funcao dizia que nao podia acontecer.
  //
  // ⚠️ NA MAQUINA DA EQUIPE AS DUAS CONCORDAVAM (todo mundo em BRT), entao o
  // defeito era invisivel aqui e so apareceu no runner do CI, que roda em UTC:
  // entre 00:00 e 03:00 UTC, Sao Paulo ainda esta no dia ANTERIOR, e o rotulo
  // dizia "Atrasada 1 dia" sobre uma tarefa que vence hoje. **Fuso do ambiente
  // nao pode decidir regra de produto.**
  //
  // ⚠️ OS DOIS LADOS EM `T00:00:00Z`: sao datas puras, e ancorar as duas no
  // MESMO meridiano faz a subtracao dar dias inteiros exatos. UTC nao tem
  // horario de verao, entao nao ha dia de 23 ou 25 horas para arredondar.
  const due = Date.parse(dueDate + "T00:00:00Z");
  const hoje = Date.parse(agoraNoWorkspace().data + "T00:00:00Z");
  return Math.round((due - hoje) / 86400000);
}

export function deadlineTone(
  dueDate: string | null | undefined,
  status: string,
  isArchived: boolean,
  /** Spec 038, fatia B. Ausente = sem hora -- ver `deadlineTonePorColuna`. */
  dueTime?: string | null
): DeadlineTone {
  if (!dueDate || isArchived) return null;
  // Concluida/cancelada/bloqueada -> sem alerta (nao ha o que agir no prazo).
  if (status === "COMPLETED" || status === "CANCELLED" || status === "BLOCKED") {
    return null;
  }
  // ⚠️ MESMA regra do `deadlineTonePorColuna` -- as duas chamam `estaAtrasada`
  // em vez de cada uma fazer a propria conta. Duas fontes de verdade para
  // "atrasou?" divergiriam no primeiro ajuste de fuso.
  if (estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) return "overdue";
  const dias = deadlineDays(dueDate);
  if (dias <= 2) return "soon";
  return null;
}

// Rotulo relativo do prazo (ex.: "Atrasada 2 dias", "Vence hoje", "Vence em 2
// dias"). So chamar quando deadlineTone != null.
//
// ⚠️ ELE PRECISA DA HORA PELO MESMO MOTIVO QUE O `deadlineTone`, e ESQUECER
// ISSO FOI UM DEFEITO REAL (achado pela Camila na tela, 18/08): a tarefa ficava
// VERMELHA e o rotulo dizia "Vence hoje". Cor e texto discordando sobre a mesma
// tarefa e pior que os dois errados -- e o `TaskDetailChecklist.test.tsx` existe
// por causa de um defeito identico ("o card dizia 2/2 e o detalhe 0/2").
//
// ⚠️ O TOM E O ROTULO TEM DE SAIR DA MESMA REGRA. Os dois chamam
// `estaAtrasada`; um deles calculando por conta propria e como as duas fontes
// de verdade voltam.
export function deadlineLabel(
  dueDate: string,
  /** Spec 038, fatia B. Ausente = sem hora. */
  dueTime?: string | null
): string {
  const dias = deadlineDays(dueDate);
  if (dias < 0) return dias === -1 ? "Atrasada 1 dia" : `Atrasada ${-dias} dias`;
  const hhmm = dueTime ? dueTime.slice(0, 5) : null;
  if (dias === 0) {
    // ⚠️ O CASO QUE O ROTULO ANTIGO NAO SABIA DIZER. Com hora, "hoje" tem dois
    // estados -- ja passou e ainda nao --, e os dois caiam em "Vence hoje".
    if (hhmm && estaAtrasada(dueDate, dueTime, agoraNoWorkspace())) {
      return `Venceu às ${hhmm}`;
    }
    return hhmm ? `Vence hoje às ${hhmm}` : "Vence hoje";
  }
  if (dias === 1) return hhmm ? `Vence amanhã às ${hhmm}` : "Vence amanhã";
  return `Vence em ${dias} dias`;
}
