/**
 * ÁREA = time raiz. Spec 046, fatia 1.
 *
 * FRONTEIRA (Spec 027): isto é DECISÃO, então mora em `lib/` -- função pura,
 * sem React, sem `fetch`, testável. O `api.ts` chama daqui.
 *
 * ⚠️⚠️ ESTE ARQUIVO EXISTE PARA MATAR UM DEFEITO QUE AINDA NÃO PODE
 * ACONTECER, e é por isso que ele vem ANTES do backend nesta spec.
 *
 * Até aqui o front respondia "qual é a raiz?" com:
 *
 *     teams.find((t) => t.parent_team_id === null)
 *
 * Com uma raiz só, correto. Com três, `find` devolve **a primeira da ordem em
 * que a API respondeu** -- e essa ordem não é contrato de ninguém: nenhum
 * `ORDER BY` a promete, e ela pode mudar por causa de um `VACUUM`.
 *
 * ⚠️ E o valor não é rótulo: é o `team_id` que o `createTask` fixa no corpo.
 * **Tarefa criada no quadro geral nasceria numa área arbitrária** -- talvez a
 * de outro departamento -- sem erro, sem aviso, sem teste vermelho. É o tipo
 * de defeito que só aparece semanas depois, numa conversa do tipo "por que
 * essa tarefa está no quadro do TI?".
 *
 * ⚠️ POR ISSO A AMBIGUIDADE LEVANTA em vez de escolher. Escolher errado grava
 * dado errado, e o dado errado sobrevive ao conserto do código; levantar
 * interrompe uma pessoa que está olhando para a tela e pode decidir. A ADR
 * 0001 do front já mandava fazer isso -- *"QUANDO subtimes existirem, trocar
 * este null por erro duro, senão a herança silenciosa volta"* -- e a troca
 * nunca aconteceu. É esta.
 *
 * ⚠️ ORDEM DE APLICAÇÃO, e ela não é negociável: esta fatia vai ANTES da que
 * derruba o índice `team_unica_raiz_por_workspace` (fatia 2). Invertida, a
 * janela entre as duas é uma janela de tarefas nascendo na área errada em
 * produção.
 */

import type { Team } from "./api";

/**
 * Por que a área é levantada em vez de resolvida.
 *
 * ⚠️ DOIS MOTIVOS, E ELES PEDEM CONVERSAS DIFERENTES: "nenhuma" é workspace
 * quebrado (ou lista que não carregou); "varias" é a tela precisando saber de
 * QUAL área se está falando. Um `catch` que trate os dois igual vai dizer a
 * frase errada em metade dos casos.
 */
export type MotivoDeAreaIndefinida = "nenhuma" | "varias";

export class AreaIndefinidaError extends Error {
  readonly motivo: MotivoDeAreaIndefinida;
  /** Ids das áreas encontradas -- vazio quando `motivo` é "nenhuma". */
  readonly areas: readonly string[];

  constructor(motivo: MotivoDeAreaIndefinida, areas: readonly string[]) {
    super(
      motivo === "nenhuma"
        ? "Não consegui identificar a área: este workspace não tem nenhum time principal."
        : "Este workspace tem mais de uma área, e esta tela ainda não pergunta qual.",
    );
    this.name = "AreaIndefinidaError";
    this.motivo = motivo;
    this.areas = areas;
  }
}

/**
 * As áreas do workspace -- os times sem pai --, em ordem ESTÁVEL.
 *
 * ⚠️ A ORDENAÇÃO POR NOME É O PONTO, e não enfeite. A ordem da API não é
 * contrato; qualquer tela que precise de "a primeira" precisa de um critério
 * que não mude sozinho entre dois carregamentos. `localeCompare` com "pt-BR"
 * pelo mesmo motivo de `listSubteams`: acento não pode jogar "Ártico" para o
 * fim da lista.
 */
export function rootTeams(teams: readonly Team[]): Team[] {
  return teams
    .filter((t) => t.parent_team_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Teto de saltos ao subir a árvore. Ela tem três níveis; 50 é folga. */
const MAX_SALTOS = 50;

/**
 * O time RAIZ acima de `teamId` — sobe a árvore até o que não tem pai.
 *
 * ⚠️⚠️ ELA EXISTIA DUAS VEZES, privada, em `lib/contextSwitcher.ts` e
 * `lib/lens.ts`, e a Spec 048 (fatia A) precisava da terceira. Três cópias de
 * uma caminhada de árvore é o defeito que este projeto já pagou com a regra de
 * alcance (Spec 034, D2/D4): ela divergiu entre duas cópias e ninguém viu.
 *
 * ⚠️⚠️ E AS DUAS CÓPIAS JÁ DIVERGIAM, num caso: **pai pendurado** (o ancestral
 * não está na lista recebida). A de `lens.ts` fazia `break` e devolvia o último
 * nó conhecido — ou seja, **afirmava que um subtime era raiz**. A de
 * `contextSwitcher.ts` devolvia `null`.
 *
 * Esta unifica no `null`, e a escolha é fail-closed: "não sei qual é a raiz" faz
 * o chamador cair no caminho de reserva (o nome da organização, o time da
 * pessoa), enquanto o último-nó-conhecido escreve um time errado como se fosse
 * certo — e recortar uma tela por um subtime achando que é raiz é exatamente o
 * tipo de resposta errada que não levanta erro.
 *
 * ⚠️ Na prática as duas dão o mesmo resultado hoje: quem chama passa a árvore
 * INTEIRA (`listTeamsAll`), onde não há pai pendurado. A divergência era latente
 * — e é por isso que ela merecia ser resolvida de propósito, e não por acidente
 * de qual cópia sobrou.
 *
 * ⚠️ O teto de saltos existe porque ciclo em dado é mais barato que travar a
 * aba: um `parent_team_id` apontando para um descendente giraria para sempre.
 */
export function rootTeamOf(
  teamId: string,
  teams: readonly Team[],
): string | null {
  const byId = new Map(teams.map((t) => [t.id, t]));
  let atual = byId.get(teamId);
  let saltos = 0;
  while (atual && atual.parent_team_id !== null && saltos < MAX_SALTOS) {
    saltos += 1;
    atual = byId.get(atual.parent_team_id);
  }
  return atual ? atual.id : null;
}

/**
 * A ÚNICA área do workspace. Levanta se não houver exatamente uma.
 *
 * É o que substitui o `find`. Toda tela que ainda pergunta "qual é a raiz?"
 * sem dizer de qual área fala passa por aqui -- e, no dia em que a segunda
 * área existir, para de funcionar em voz alta em vez de escolher no sorteio.
 *
 * ⚠️ QUEM CHAMA ISTO ESTÁ ASSUMINDO QUE SÓ HÁ UMA ÁREA. A saída definitiva
 * não é tratar o erro: é a tela receber a área de fora (pela URL), o que é a
 * fatia 4 desta spec. Até lá, este erro é o marcador de cada lugar que ainda
 * precisa ser convertido -- procure os chamadores para achar a lista.
 */
export function soleRootTeam(teams: readonly Team[]): Team {
  const raizes = rootTeams(teams);
  if (raizes.length === 0) throw new AreaIndefinidaError("nenhuma", []);
  if (raizes.length > 1) {
    throw new AreaIndefinidaError(
      "varias",
      raizes.map((t) => t.id),
    );
  }
  return raizes[0];
}

/**
 * O endereço do quadro geral de uma área.
 *
 * ⚠️⚠️ UMA FUNÇÃO, E NÃO UM TEMPLATE ESPALHADO. A §4.4 decidiu que a área
 * mora na URL -- é o que faz o link ser compartilhável e o botão Voltar
 * funcionar, coisas que "área ativa" guardada em estado não dá. Uma decisão
 * dessas vira mentira no dia em que dois lugares montarem a string de jeitos
 * diferentes.
 *
 * ⚠️ E NÃO HÁ ROTA NOVA AQUI: `/quadro/[teamId]` já existia, e até a Spec 046
 * ela RECUSAVA o id de uma área ("Este é o time principal, use o quadro
 * geral"). A fatia 4 tirou essa trava. O endereço é o mesmo de sempre; o que
 * mudou foi ele passar a aceitar quem antes era barrado.
 */
export function urlDoQuadroDeArea(areaId: string): string {
  return `/quadro/${areaId}`;
}

/**
 * O que a rota `/quadro` (SEM área na URL) deve fazer.
 *
 * ⚠️⚠️ ESTA DECISÃO MORA AQUI, E NÃO DENTRO DA PÁGINA, pelo motivo que este
 * projeto já pagou uma vez: `app/` está FORA do `include` do vitest, então
 * regra escrita lá não tem guardião nenhum. Foi por isso que
 * `candidatosParaAdicionar` mudou de casa na Spec 044, e a lição vale igual
 * aqui -- com uma área só, "redirecionar" e "desenhar" dão o mesmo resultado
 * visível, e um erro nesta escolha não apareceria em teste nenhum.
 *
 * As três saídas, e por que cada uma:
 *
 *   `desenhar`      -- uma área só: é o comportamento de sempre, e `/quadro`
 *                      continua sendo um endereço que funciona.
 *   `redirecionar`  -- várias: NÃO escolhe calada. Manda para
 *                      `/quadro/<área>`, e daí em diante a URL diz qual é
 *                      (§4.4). É a diferença entre um default de entrada e
 *                      "área ativa" -- esta última faria duas pessoas verem
 *                      coisas diferentes no mesmo link.
 *   `sem-area`      -- workspace quebrado. Não há para onde mandar, e
 *                      inventar um destino seria pior que mostrar o vazio.
 *
 * ⚠️ O DESTINO É A PRIMEIRA POR NOME, e a estabilidade é o ponto: `rootTeams`
 * ordena, então duas visitas seguidas caem na mesma área. Com a ordem da API,
 * a pessoa entraria em áreas diferentes sem ter mudado nada.
 */
export type EntradaDoQuadro =
  | { readonly tipo: "desenhar"; readonly areaId: string }
  | { readonly tipo: "redirecionar"; readonly para: string }
  | { readonly tipo: "sem-area" };

export function entradaDoQuadro(teams: readonly Team[]): EntradaDoQuadro {
  const areas = rootTeams(teams);
  if (areas.length === 0) return { tipo: "sem-area" };
  if (areas.length === 1) return { tipo: "desenhar", areaId: areas[0].id };
  return { tipo: "redirecionar", para: urlDoQuadroDeArea(areas[0].id) };
}
