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

// ===========================================================================
// SELO "PARADA HA X DIAS" (Spec 031, C2 / D6)
// ===========================================================================
//
// ⚠️⚠️ ESTE BLOCO TEM DATA DE DEMOLICAO (Spec 036, fatia 4c / ADR 0040).
//
// `deadlineTone` reimplementa a mao o que `column.semantic` e
// `column.notify_deadline` ja dizem. Ele funciona para os 8 status legados e
// SO para eles: coluna criada por gente nasce com `legacy_status` NULL e cai
// fora da lista aqui, em silencio. (`diasParado` e `statusPadraoMinhasTarefas`,
// do mesmo bloco, sairam na limpeza de codigo morto: nao tinham mais leitor.)
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

/**
 * ⚠️ `plural` SAIU DAQUI na fatia 4a (ADR 0040). Mora em `lib/plural.ts`.
 *
 * Ela nunca teve relacao com status: `lib/exclusao.ts` a importava daqui so
 * porque foi aqui que ela nasceu -- evidencia, medida na
 * sondagem da fatia 4 (absorvida no `plan.md` em 13/08), de que este modulo
 * tinha virado gaveta. Importe de `@/lib/plural`.
 */

/** Rotulo do selo. So chamar quando `diasParadoPorColuna` != null. */
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

// Data ABSOLUTA do prazo, com a hora quando ela existe: "19/08/2026" ou
// "19/08/2026 18:00".
//
// ⚠️ ESTE HELPER NASCEU DE UM DEFEITO, e nao de arrumacao. O tom do prazo
// (`deadlineTonePorColuna`) le a hora desde a Spec 038; o TEXTO ao lado dele
// nao lia. Resultado no quadro: card VERMELHO com "21/08/2026" -- vence hoje,
// ja passou das 18h, e nada na tela dizia isso. E o MESMO defeito que o
// `deadlineLabel` levou em 18/08 ("ficava vermelha e o rotulo dizia 'Vence
// hoje'"), na outra metade da tela; o conserto de la nao alcancou o card
// porque o card usa data absoluta, e nao rotulo relativo.
//
// ⚠️ `slice(0, 5)` PORQUE O BACKEND DEVOLVE `HH:MM:SS`. Sem cortar, sai
// "19/08/2026 18:00:00". Esta linha estava copiada na capsula do detalhe e ia
// ser copiada em mais dois lugares -- por isso virou funcao.
export function dataHoraBR(
  dueDate: string,
  /** Spec 038, fatia B. Ausente = sem hora. */
  dueTime?: string | null
): string {
  // `T00:00:00` sem sufixo de fuso = meia-noite LOCAL. Sem ele, `new Date`
  // trata `YYYY-MM-DD` como UTC e o dia anda para tras a oeste de Greenwich.
  const dia = new Date(dueDate + "T00:00:00").toLocaleDateString("pt-BR");
  return dueTime ? `${dia} ${dueTime.slice(0, 5)}` : dia;
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
