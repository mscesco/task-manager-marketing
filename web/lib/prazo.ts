/**
 * Spec 038, fatia B — "esta tarefa está atrasada?", com hora opcional.
 *
 * FRONTEIRA (Spec 027): isto é DECISÃO, então mora em `lib/` — função pura, sem
 * React, testável. A tela desenha; não decide.
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE NÃO É `deadlineDays` COM UM
 * PARÂMETRO A MAIS. Aquela função devolve DIAS, e dia não expressa "venceu às
 * 18:00 e agora são 18:01" — isso continua sendo dia zero. Atraso com hora é uma
 * pergunta de SIM/NÃO sobre um instante, e é isso que se responde aqui.
 * `deadlineDays` continua viva e continua servindo a janela de "vence em 2 dias"
 * e os rótulos, que são em dias de propósito.
 *
 * ⚠️⚠️ A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA DESARMAR, e ela é silenciosa.
 * Até aqui, "atrasada" era `t.due_date < hoje` — comparação de STRING entre duas
 * datas ISO, que ordena certo. Com hora, o valor do backend passa a poder ser
 * comparado contra uma data pura, e aí:
 *
 *     "2026-08-19" < "2026-08-19 18:00"   →  true   (prefixo é MENOR)
 *
 * ou seja, a string mais curta perde SEMPRE. Uma comparação ingênua diria que a
 * tarefa não venceu, sem erro, sem log e sem nada na tela — a mesma família do
 * `str.replace` que falha calado. Aqui os dois lados são normalizados ao MESMO
 * formato antes de comparar, e é isso que torna a comparação de string segura de
 * novo.
 *
 * ⚠️ E A SAÍDA ÓBVIA — `new Date(due_date)` — É PROIBIDA, e o aviso já existia
 * no `hojeISO()` do `Board.tsx`: `new Date("2026-08-19")` é interpretado como
 * UTC e escorrega um dia em fuso negativo. **Não há `new Date` sobre valor do
 * backend em lugar nenhum deste arquivo.**
 */

/**
 * O fuso em que "hoje" e "agora" são decididos.
 *
 * ⚠️ FIXO, E NÃO O DO NAVEGADOR (decisão da Camila, 18/08). E não é escolha
 * nova: o `DeadlineNotifyService` já usa `America/Sao_Paulo` desde a Spec 023
 * (D7), porque perto da meia-noite UTC/BRT divergem e o dia sairia errado. O
 * front é que vinha usando o fuso do navegador e **coincidia** por todo mundo
 * estar no Brasil. Agora a tela e o job concordam por construção, e não por
 * geografia.
 *
 * ⚠️ SE UM DIA O TIME FOR MULTI-FUSO, o que muda é a EXIBIÇÃO, não o dado:
 * `due_date` + `due_time` mais este fuso já são um instante sem ambiguidade.
 * Trocar para "o fuso de quem olha" é mexer aqui e nos rótulos — sem migration.
 */
export const FUSO_DO_WORKSPACE = "America/Sao_Paulo";

/** "Agora" no fuso do workspace, já em texto comparável. */
export type Agora = {
  /** `YYYY-MM-DD` */
  readonly data: string;
  /** `HH:MM`, 24h */
  readonly hora: string;
};

/**
 * Normaliza a hora do backend para `HH:MM`.
 *
 * ⚠️ O POSTGRES DEVOLVE `TIME` COMO `"18:00:00"`, com segundos. Comparar
 * `"18:00:00"` com `"18:00"` como string dá o resultado errado pelo mesmo
 * motivo do prefixo descrito no topo — a mais longa vence. Cortar em 5 resolve
 * antes de qualquer comparação existir.
 */
function hhmm(hora: string): string {
  return hora.slice(0, 5);
}

/**
 * `Agora` no fuso do workspace, lido do relógio da máquina.
 *
 * ⚠️ `Intl`, E NÃO ARITMÉTICA DE OFFSET. Somar ou subtrair 3 horas quebra no
 * horário de verão e em qualquer mudança de regra de fuso — e o Brasil já mudou
 * a dele. O `Intl` carrega a base de fusos do navegador e acerta sozinho.
 *
 * ⚠️ `en-CA` PORQUE ELE FORMATA DATA COMO `YYYY-MM-DD`, que é o formato que
 * ordena como string. `pt-BR` daria `19/08/2026`, que ordena errado.
 */
export function agoraNoWorkspace(agora: Date = new Date()): Agora {
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DO_WORKSPACE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  const hora = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO_DO_WORKSPACE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(agora);
  return { data, hora: hhmm(hora) };
}

/**
 * O DIA (`YYYY-MM-DD`) de um instante ISO completo, no fuso do workspace.
 *
 * Spec 053 (F): a tela de notificacoes agrupa por dia. ⚠️ Sem isto, um aviso
 * das 23h de Brasilia cairia no dia seguinte para quem estivesse num runner
 * em UTC -- o defeito de fuso que o AGENTS.md conta.
 */
export function diaNoWorkspace(iso: string): string {
  return agoraNoWorkspace(new Date(iso)).data;
}

/**
 * A tarefa passou do prazo?
 *
 * ⚠️ SÃO DUAS REGRAS, E A DE CIMA É A DE SEMPRE:
 *
 *   - **sem hora** → atrasa quando o DIA acaba. Prazo "19/08" só vence depois
 *     que o dia 19 terminou. É o comportamento de 100% das 1085 tarefas de
 *     produção em 18/08, e ele não pode mudar por causa desta fatia;
 *   - **com hora** → atrasa no instante. "19/08 18:00" vence às 18:01.
 *
 * ⚠️ HORA SEM DATA DEVOLVE `false`, e não explode. O backend recusa esse par com
 * 422 (`TaskService._validate_hora`), então ele não existe em dado válido — mas
 * a tela não é o lugar de descobrir isso, e uma tarefa não pode ficar vermelha
 * por um estado que ninguém consegue enxergar nem consertar pela interface.
 */
export function estaAtrasada(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
  agora: Agora
): boolean {
  if (!dueDate) return false;
  if (!dueTime) return dueDate < agora.data;
  return `${dueDate} ${hhmm(dueTime)}` < `${agora.data} ${agora.hora}`;
}
