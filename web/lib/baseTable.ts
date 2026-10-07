// lib/baseTable.ts
// A regra pura da tela da Base (Spec 056) -- o que a tabela DECIDE, separado
// do que ela desenha (a fronteira da Spec 027). Testada em
// `lib/__tests__/baseTable.test.ts`.

import type {
  BaseCellValue,
  BaseColumn,
  BaseColumnType,
  BaseOptionColor,
  BaseSummary,
  Team,
} from "@/lib/api";

// --------------------------------------------------------------- cor
/** A cor da opção, como `var()` para o `Badge` -- os tokens `--opt-*` do
 *  `globals.css`, medidos COM a tinta nos dois temas. */
export function corDaOpcao(cor: BaseOptionColor): string {
  return `var(--opt-${cor})`;
}

export const CORES_DE_OPCAO: readonly BaseOptionColor[] = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];

export const NOME_DA_COR: Record<BaseOptionColor, string> = {
  gray: "Cinza",
  brown: "Marrom",
  orange: "Laranja",
  yellow: "Amarelo",
  green: "Verde",
  blue: "Azul",
  purple: "Roxo",
  pink: "Rosa",
  red: "Vermelho",
};

/** A próxima cor para uma opção nova: a primeira da paleta ainda não usada na
 *  coluna, e o ciclo recomeça quando todas foram. */
export function proximaCor(usadas: readonly BaseOptionColor[]): BaseOptionColor {
  const livre = CORES_DE_OPCAO.find((c) => !usadas.includes(c));
  return livre ?? CORES_DE_OPCAO[usadas.length % CORES_DE_OPCAO.length];
}

// --------------------------------------------------------------- tipo
export const NOME_DO_TIPO: Record<BaseColumnType, string> = {
  title: "Título",
  text: "Texto",
  number: "Número",
  date: "Data",
  select: "Seleção",
  multi_select: "Seleção múltipla",
  person: "Pessoa",
  link: "Link",
  checkbox: "Caixa de seleção",
};

/** Os tipos que a pessoa escolhe ao criar ou trocar -- o título é único e
 *  nasce com a base (D2). */
export const TIPOS_ESCOLHIVEIS: readonly BaseColumnType[] = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "person",
  "link",
  "checkbox",
];

/** Tipos cuja célula se edita digitando num campo de texto. */
export function editaComTexto(tipo: BaseColumnType): boolean {
  return ["title", "text", "number", "date", "link"].includes(tipo);
}

// --------------------------------------------------------------- data
/** "2026-08-05" -> "05/08/2026".
 *
 *  ⚠️ SEM `Date` E SEM `Intl`, de propósito (web/AGENTS.md §0.1): a célula de
 *  data é só DIA, sem hora e sem fuso, e reformatar a string não tem como errar
 *  o dia entre 00:00 e 03:00 -- que é o defeito que o §0.1 existe para evitar. */
export function dataParaTela(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// --------------------------------------------------------------- pessoa
export type PessoaConhecida = { name: string; is_active: boolean };

/** O rótulo de quem está numa célula de Pessoa (D8, D22).
 *
 *  - ativo e da árvore            -> "Ana"
 *  - conta desativada             -> "Ana (inativo)"
 *  - conta ativa, fora da árvore  -> "Ana (fora do time)"
 *  - desconhecido (nem no cadastro) -> "Pessoa removida"
 *
 *  ⚠️ Chamar de inativo quem só trocou de time seria mentir -- por isso os dois
 *  rótulos. E o NOME fica: ele diz quem fez aquele post. */
export function rotuloDePessoa(
  id: string,
  daArvore: ReadonlySet<string>,
  todos: ReadonlyMap<string, PessoaConhecida>
): string {
  const p = todos.get(id);
  if (!p) return "Pessoa removida";
  if (!p.is_active) return `${p.name} (inativo)`;
  if (!daArvore.has(id)) return `${p.name} (fora do time)`;
  return p.name;
}

// --------------------------------------------------------------- célula
/** O texto de uma célula, para os tipos que se desenham como texto. Seleção,
 *  pessoa e caixa de seleção têm desenho próprio na tabela. */
export function textoDaCelula(
  coluna: BaseColumn,
  valor: BaseCellValue | undefined
): string {
  if (valor === undefined || valor === null) return "";
  switch (coluna.type) {
    case "date":
      return typeof valor === "string" ? dataParaTela(valor) : "";
    case "number":
      return typeof valor === "number" ? numeroParaTela(valor) : "";
    case "checkbox":
      return valor === true ? "Sim" : "Não";
    default:
      return typeof valor === "string" ? valor : "";
  }
}

/** 1234.5 -> "1234,5". Vírgula decimal, sem separador de milhar (a célula é
 *  estreita, e o milhar com ponto confunde quem digita de volta). */
export function numeroParaTela(n: number): string {
  return String(n).replace(".", ",");
}

/** O texto que o editor de uma célula de texto abre preenchido. */
export function textoParaEditar(
  coluna: BaseColumn,
  valor: BaseCellValue | undefined
): string {
  if (valor === undefined || valor === null) return "";
  if (coluna.type === "number" && typeof valor === "number") return numeroParaTela(valor);
  return typeof valor === "string" ? valor : "";
}

export type Interpretado =
  | { ok: true; valor: BaseCellValue | null }
  | { ok: false; erro: string };

/** O que a pessoa digitou, como valor para gravar. Vazio = esvaziar a célula.
 *  A validação final é do servidor; esta só evita mandar o que ele recusaria. */
export function interpretarDigitado(coluna: BaseColumn, bruto: string): Interpretado {
  const texto = bruto.trim();
  if (!texto) return { ok: true, valor: null };
  switch (coluna.type) {
    case "title":
    case "text":
      return { ok: true, valor: texto };
    case "number": {
      // "1.234,5" e "1234.5" e "1234,5" -- o ponto só é decimal se não houver
      // vírgula.
      const normal = texto.includes(",")
        ? texto.replace(/\./g, "").replace(",", ".")
        : texto;
      const n = Number(normal);
      return Number.isFinite(n) && /^-?[\d.]+$/.test(normal)
        ? { ok: true, valor: n }
        : { ok: false, erro: "Digite um número." };
    }
    case "date": {
      // O `<input type="date">` entrega AAAA-MM-DD; aceita também DD/MM/AAAA.
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
      const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : texto;
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) && dataExiste(iso)
        ? { ok: true, valor: iso }
        : { ok: false, erro: "Data inválida." };
    }
    case "link":
      return /^https?:\/\/\S+$/i.test(texto)
        ? { ok: true, valor: texto }
        : { ok: false, erro: "O link precisa começar com http:// ou https://." };
    default:
      return { ok: false, erro: "Este tipo não se edita digitando." };
  }
}

function dataExiste(iso: string): boolean {
  const [a, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dias = [31, a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dias[m - 1];
}

// --------------------------------------------------------------- teclado
export type Posicao = { linha: number; coluna: number };

/** A célula seguinte, para as setas, o Tab e o Enter (spec §12). Para na
 *  borda, em vez de dar a volta -- a volta faz o foco "sumir" para quem não vê
 *  a tela. Tab no fim da linha vai para a primeira célula da próxima. */
export function mover(
  p: Posicao,
  tecla: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Tab" | "ShiftTab" | "Enter",
  linhas: number,
  colunas: number
): Posicao {
  const limitar = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  switch (tecla) {
    case "ArrowUp":
      return { ...p, linha: limitar(p.linha - 1, linhas) };
    case "ArrowDown":
    case "Enter":
      return { ...p, linha: limitar(p.linha + 1, linhas) };
    case "ArrowLeft":
      return { ...p, coluna: limitar(p.coluna - 1, colunas) };
    case "ArrowRight":
      return { ...p, coluna: limitar(p.coluna + 1, colunas) };
    case "Tab":
      if (p.coluna < colunas - 1) return { ...p, coluna: p.coluna + 1 };
      return p.linha < linhas - 1 ? { linha: p.linha + 1, coluna: 0 } : p;
    case "ShiftTab":
      if (p.coluna > 0) return { ...p, coluna: p.coluna - 1 };
      return p.linha > 0 ? { linha: p.linha - 1, coluna: colunas - 1 } : p;
  }
}

// --------------------------------------------------------------- lista
export type GrupoDeBases = { raiz: Team | null; bases: BaseSummary[] };

/** As bases agrupadas pelo time raiz, na ordem dos times, e por nome dentro.
 *  Uma raiz só -> um grupo só, e a tela não mostra o título do grupo. Base de
 *  time que a lista de times não trouxe vai para um grupo sem raiz no fim. */
export function agruparPorRaiz(
  bases: readonly BaseSummary[],
  times: readonly Team[]
): GrupoDeBases[] {
  const raizes = times.filter((t) => t.parent_team_id === null);
  const grupos: GrupoDeBases[] = [];
  for (const raiz of raizes) {
    const doTime = bases.filter((b) => b.team_id === raiz.id);
    if (doTime.length) grupos.push({ raiz, bases: ordenarPorNome(doTime) });
  }
  const conhecidas = new Set(raizes.map((r) => r.id));
  const soltas = bases.filter((b) => !conhecidas.has(b.team_id));
  if (soltas.length) grupos.push({ raiz: null, bases: ordenarPorNome(soltas) });
  return grupos;
}

function ordenarPorNome(bases: BaseSummary[]): BaseSummary[] {
  return [...bases].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** O time raiz de um time (ele mesmo, se já for raiz). `null` se o id não está
 *  na lista. Serve para pré-escolher onde criar a base a partir do time ativo
 *  do menu -- que pode ser um subtime, e a base mora na raiz (D6). */
export function raizDe(teamId: string | null, times: readonly Team[]): string | null {
  if (!teamId) return null;
  const porId = new Map(times.map((t) => [t.id, t]));
  let atual = porId.get(teamId);
  const vistos = new Set<string>();
  while (atual && atual.parent_team_id && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    atual = porId.get(atual.parent_team_id);
  }
  return atual ? atual.id : null;
}

// --------------------------------------------------------------- teto
/** O aviso de linhas (D23, spec §8.1). `null` = nada a dizer. */
export function avisoDeLinhas(
  total: number,
  avisoEm: number,
  teto: number
): { nivel: "aviso" | "teto"; texto: string } | null {
  if (total >= teto) {
    return {
      nivel: "teto",
      texto: `Esta base chegou ao limite de ${teto.toLocaleString("pt-BR")} linhas. Para criar mais, apague linhas antigas ou fale com quem administra o sistema.`,
    };
  }
  if (total >= avisoEm) {
    return {
      nivel: "aviso",
      texto: `Esta base tem ${total.toLocaleString("pt-BR")} de ${teto.toLocaleString("pt-BR")} linhas possíveis.`,
    };
  }
  return null;
}

// --------------------------------------------------------------- excluir
/** D26: excluir pede o nome. Espaço nas pontas não conta; maiúscula conta. */
export function nomeConfere(digitado: string, nome: string): boolean {
  return digitado.trim() === nome.trim();
}
