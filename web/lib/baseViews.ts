// lib/baseViews.ts
// As visões da Base (Spec 056, fatia F, §8): filtro, ordenação, colunas
// visíveis, o quadro e o calendário. Regra pura, testada em
// `lib/__tests__/baseViews.test.ts`.
//
// ⚠️⚠️ FILTRO E ORDENAÇÃO ACONTECEM AQUI, NO NAVEGADOR, com a base inteira
// carregada (spec §8.1). É o que o teto de 5.000 linhas mantém barato, e o que
// deixa o ao vivo simples: a linha nova chega e a tela reordena sozinha.

import type { BaseCellValue, BaseColumn, BaseColumnType, BaseRow, BaseView } from "@/lib/api";

// --------------------------------------------------------------- config
export type OperadorDeFiltro =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "not_empty"
  | "before"
  | "after"
  | "greater"
  | "less"
  | "has_any"
  | "has_none"
  | "is_checked"
  | "not_checked";

export type Filtro = {
  column_id: string;
  operator: OperadorDeFiltro;
  value?: string | number | string[];
};

export type Ordem = { column_id: string; direction: "asc" | "desc" };

export type ConfigDaVisao = {
  filters: Filtro[];
  sorts: Ordem[];
  hidden_columns: string[];
  group_by: string | null;
  date_column: string | null;
  /** Fatia I, "Congelar": a coluna ATÉ a qual a tabela fica presa na rolagem
   *  horizontal. `null` = só o título. */
  frozen_column: string | null;
};

/** O `config` cru do servidor, normalizado. Defensivo: o que não tem a forma
 *  esperada é ignorado, e uma visão com config estranha ainda abre. */
export function lerConfig(config: Record<string, unknown> | undefined): ConfigDaVisao {
  const c = config ?? {};
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    filters: lista(c.filters).filter(
      (f): f is Filtro =>
        typeof f === "object" && f !== null && typeof (f as Filtro).column_id === "string" &&
        typeof (f as Filtro).operator === "string"
    ),
    sorts: lista(c.sorts).filter(
      (o): o is Ordem =>
        typeof o === "object" && o !== null && typeof (o as Ordem).column_id === "string" &&
        ((o as Ordem).direction === "asc" || (o as Ordem).direction === "desc")
    ),
    hidden_columns: lista(c.hidden_columns).filter((x): x is string => typeof x === "string"),
    group_by: typeof c.group_by === "string" ? c.group_by : null,
    date_column: typeof c.date_column === "string" ? c.date_column : null,
    frozen_column: typeof c.frozen_column === "string" ? c.frozen_column : null,
  };
}

// --------------------------------------------------------------- congelar
/** Quantas colunas (da esquerda) ficam presas na rolagem horizontal.
 *  Pelo menos UMA: o título fica sempre (é por ele que se sabe de que linha
 *  se fala). Coluna congelada que sumiu ou foi ocultada -> só o título. */
export function quantasCongeladas(
  visiveis: readonly BaseColumn[],
  config: ConfigDaVisao
): number {
  if (!config.frozen_column) return Math.min(1, visiveis.length);
  const i = visiveis.findIndex((c) => c.id === config.frozen_column);
  return i < 0 ? Math.min(1, visiveis.length) : i + 1;
}

/** O `left` de cada coluna presa: a soma das larguras das anteriores. ⚠️ É
 *  por isso que a tabela tem largura FIXA por coluna -- com largura pelo
 *  conteúdo, a segunda coluna presa não saberia onde a primeira acaba. */
export function deslocamentos(larguras: readonly number[]): number[] {
  const saida: number[] = [];
  let soma = 0;
  for (const l of larguras) {
    saida.push(soma);
    soma += l;
  }
  return saida;
}

/** A largura com que cada coluna é desenhada: a escolhida, ou o padrão. */
export function larguraDa(coluna: BaseColumn, indice: number): number {
  return coluna.width ?? (indice === 0 ? 240 : 160);
}

// --------------------------------------------------------------- operadores
export type OpcaoDeOperador = { id: OperadorDeFiltro; label: string; precisaValor: boolean };

const VAZIO: OpcaoDeOperador[] = [
  { id: "is_empty", label: "está vazio", precisaValor: false },
  { id: "not_empty", label: "não está vazio", precisaValor: false },
];

/** Os operadores que fazem sentido para cada tipo de coluna. */
export function operadoresDo(tipo: BaseColumnType): OpcaoDeOperador[] {
  switch (tipo) {
    case "title":
    case "text":
    case "link":
      return [
        { id: "contains", label: "contém", precisaValor: true },
        { id: "not_contains", label: "não contém", precisaValor: true },
        { id: "equals", label: "é", precisaValor: true },
        ...VAZIO,
      ];
    case "number":
      return [
        { id: "equals", label: "=", precisaValor: true },
        { id: "greater", label: ">", precisaValor: true },
        { id: "less", label: "<", precisaValor: true },
        ...VAZIO,
      ];
    case "date":
      return [
        { id: "equals", label: "é", precisaValor: true },
        { id: "before", label: "antes de", precisaValor: true },
        { id: "after", label: "depois de", precisaValor: true },
        ...VAZIO,
      ];
    case "select":
    case "multi_select":
    case "person":
      return [
        { id: "has_any", label: "é qualquer um de", precisaValor: true },
        { id: "has_none", label: "não é nenhum de", precisaValor: true },
        ...VAZIO,
      ];
    case "checkbox":
      return [
        { id: "is_checked", label: "marcada", precisaValor: false },
        { id: "not_checked", label: "desmarcada", precisaValor: false },
      ];
  }
}

// --------------------------------------------------------------- filtro
function vazio(v: BaseCellValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function idsDe(v: BaseCellValue | undefined): string[] {
  if (Array.isArray(v)) return v;
  return typeof v === "string" ? [v] : [];
}

function texto(v: BaseCellValue | undefined): string {
  return typeof v === "string" ? v.toLocaleLowerCase("pt-BR") : "";
}

/** A linha passa neste filtro? Filtro incompleto (sem valor onde precisa)
 *  NÃO filtra: a pessoa ainda está escrevendo, e a tabela não pode sumir. */
export function passa(coluna: BaseColumn, valor: BaseCellValue | undefined, f: Filtro): boolean {
  const alvo = f.value;
  const semAlvo =
    alvo === undefined || alvo === "" || (Array.isArray(alvo) && alvo.length === 0);
  switch (f.operator) {
    case "is_empty":
      return vazio(valor);
    case "not_empty":
      return !vazio(valor);
    case "is_checked":
      return valor === true;
    case "not_checked":
      return valor !== true;
  }
  if (semAlvo) return true;
  switch (f.operator) {
    case "contains":
      return texto(valor).includes(String(alvo).toLocaleLowerCase("pt-BR"));
    case "not_contains":
      return !texto(valor).includes(String(alvo).toLocaleLowerCase("pt-BR"));
    case "equals":
      if (coluna.type === "number") return typeof valor === "number" && valor === Number(alvo);
      return texto(valor) === String(alvo).toLocaleLowerCase("pt-BR");
    case "not_equals":
      return texto(valor) !== String(alvo).toLocaleLowerCase("pt-BR");
    case "greater":
      return typeof valor === "number" && valor > Number(alvo);
    case "less":
      return typeof valor === "number" && valor < Number(alvo);
    case "before":
      return typeof valor === "string" && valor < String(alvo);
    case "after":
      return typeof valor === "string" && valor > String(alvo);
    case "has_any": {
      const quer = Array.isArray(alvo) ? alvo : [String(alvo)];
      return idsDe(valor).some((id) => quer.includes(id));
    }
    case "has_none": {
      const quer = Array.isArray(alvo) ? alvo : [String(alvo)];
      return !idsDe(valor).some((id) => quer.includes(id));
    }
  }
  return true;
}

// --------------------------------------------------------------- ordem
export type NomeDePessoa = (id: string) => string;

/** Compara dois valores da mesma coluna, crescente. ⚠️ VAZIO NÃO ENTRA AQUI:
 *  quem ordena põe os vazios no fim nas DUAS direções -- uma linha sem data
 *  no topo de "mais recentes primeiro" é ruído. */
export function comparar(
  coluna: BaseColumn,
  a: BaseCellValue,
  b: BaseCellValue,
  nomeDePessoa: NomeDePessoa = (id) => id
): number {
  switch (coluna.type) {
    case "number":
      return Number(a) - Number(b);
    case "checkbox":
      return Number(a === true) - Number(b === true);
    case "select":
    case "multi_select": {
      // Pela ordem das opções na coluna, que é a ordem que a equipe escolheu
      // (no quadro, a ordem das colunas) -- e não pelo alfabeto.
      const pos = (v: BaseCellValue) => {
        const id = idsDe(v)[0];
        const i = coluna.options.findIndex((o) => o.id === id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      return pos(a) - pos(b);
    }
    case "person":
      return nomeDePessoa(idsDe(a)[0] ?? "").localeCompare(nomeDePessoa(idsDe(b)[0] ?? ""), "pt-BR");
    default:
      // Texto, título, link e DATA (AAAA-MM-DD ordena como string).
      return String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  }
}

/** As linhas que a visão mostra, na ordem dela.
 *
 *  - filtros combinados com E; filtro de coluna que não existe mais é ignorado
 *  - ordenação estável: empate fica na ordem em que as linhas nasceram
 *  - `fixadas`: linhas criadas agora, nesta tela, passam pelo filtro -- senão
 *    a linha nova (vazia) sumiria no instante em que nasce. */
export function aplicarVisao(
  linhas: readonly BaseRow[],
  colunas: readonly BaseColumn[],
  config: ConfigDaVisao,
  opcoes: { fixadas?: ReadonlySet<string>; nomeDePessoa?: NomeDePessoa } = {}
): BaseRow[] {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const filtros = config.filters.filter((f) => porId.has(f.column_id));
  const filtradas = linhas.filter(
    (l) =>
      opcoes.fixadas?.has(l.id) ||
      filtros.every((f) => passa(porId.get(f.column_id)!, l.values[f.column_id], f))
  );
  const ordens = config.sorts.filter((o) => porId.has(o.column_id));
  if (!ordens.length) return filtradas;
  return filtradas
    .map((l, i) => ({ l, i }))
    .sort((x, y) => {
      for (const o of ordens) {
        const coluna = porId.get(o.column_id)!;
        const a = x.l.values[o.column_id];
        const b = y.l.values[o.column_id];
        const va = vazio(a);
        const vb = vazio(b);
        if (va && vb) continue;
        if (va) return 1;
        if (vb) return -1;
        const r = comparar(coluna, a, b, opcoes.nomeDePessoa);
        if (r !== 0) return o.direction === "asc" ? r : -r;
      }
      return x.i - y.i;
    })
    .map(({ l }) => l);
}

/** As colunas que a tabela desenha. O título nunca se esconde: é por ele que
 *  se sabe de que linha se está falando. */
export function colunasVisiveis(colunas: readonly BaseColumn[], config: ConfigDaVisao): BaseColumn[] {
  const escondidas = new Set(config.hidden_columns);
  return colunas.filter((c) => c.type === "title" || !escondidas.has(c.id));
}

// --------------------------------------------------------------- quadro
export type ColunaDoQuadro = {
  /** `null` = "Sem valor". */
  opcaoId: string | null;
  rotulo: string;
  linhas: BaseRow[];
};

/** O quadro: uma coluna por opção, na ordem das opções, mais "Sem valor" no
 *  fim. Opção apagada conta como sem valor (D17). Só seleção ÚNICA agrupa --
 *  uma linha com duas etiquetas estaria em duas colunas. */
export function agruparNoQuadro(linhas: readonly BaseRow[], coluna: BaseColumn): ColunaDoQuadro[] {
  const vivas = new Set(coluna.options.map((o) => o.id));
  const grupos: ColunaDoQuadro[] = coluna.options.map((o) => ({
    opcaoId: o.id,
    rotulo: o.label,
    linhas: [],
  }));
  const semValor: ColunaDoQuadro = { opcaoId: null, rotulo: "Sem valor", linhas: [] };
  for (const l of linhas) {
    const v = l.values[coluna.id];
    const id = typeof v === "string" && vivas.has(v) ? v : null;
    (id ? grupos.find((g) => g.opcaoId === id)! : semValor).linhas.push(l);
  }
  return [...grupos, semValor];
}

/** As colunas que podem agrupar o quadro e datar o calendário. */
export function colunasDeAgrupar(colunas: readonly BaseColumn[]): BaseColumn[] {
  return colunas.filter((c) => c.type === "select");
}
export function colunasDeData(colunas: readonly BaseColumn[]): BaseColumn[] {
  return colunas.filter((c) => c.type === "date");
}

// --------------------------------------------------------------- calendário
/** Dia da semana de uma data (0 = domingo), pelo algoritmo de Sakamoto.
 *  ⚠️ SEM `Date`, de propósito (web/AGENTS.md §0.1): a data da célula é só
 *  DIA, e o `Date` a leria à meia-noite UTC -- que em Brasília é o dia anterior. */
export function diaDaSemana(ano: number, mes: number, dia: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const a = mes < 3 ? ano - 1 : ano;
  return (a + Math.floor(a / 4) - Math.floor(a / 100) + Math.floor(a / 400) + t[mes - 1] + dia) % 7;
}

export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

const dois = (n: number) => String(n).padStart(2, "0");
export function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}

/** As semanas de um mês, domingo a sábado. `null` = dia de fora do mês. */
export function semanasDoMes(ano: number, mes: number): (string | null)[][] {
  const primeiro = diaDaSemana(ano, mes, 1);
  const total = diasNoMes(ano, mes);
  const casas: (string | null)[] = [
    ...Array<null>(primeiro).fill(null),
    ...Array.from({ length: total }, (_, i) => iso(ano, mes, i + 1)),
  ];
  while (casas.length % 7) casas.push(null);
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < casas.length; i += 7) semanas.push(casas.slice(i, i + 7));
  return semanas;
}

export function mesVizinho(ano: number, mes: number, passo: 1 | -1): { ano: number; mes: number } {
  const m = mes + passo;
  if (m < 1) return { ano: ano - 1, mes: 12 };
  if (m > 12) return { ano: ano + 1, mes: 1 };
  return { ano, mes: m };
}

export const NOME_DO_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** As linhas do calendário: por dia, e as sem data à parte. */
export function linhasPorDia(
  linhas: readonly BaseRow[],
  colunaData: BaseColumn
): { porDia: Map<string, BaseRow[]>; semData: BaseRow[] } {
  const porDia = new Map<string, BaseRow[]>();
  const semData: BaseRow[] = [];
  for (const l of linhas) {
    const v = l.values[colunaData.id];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const lista = porDia.get(v) ?? [];
      lista.push(l);
      porDia.set(v, lista);
    } else {
      semData.push(l);
    }
  }
  return { porDia, semData };
}

// --------------------------------------------------------------- visão
/** A visão que a tela abre: a pedida (URL), se existe; senão a padrão. */
export function visaoAtiva(views: readonly BaseView[], pedida: string | null): BaseView | null {
  return (
    views.find((v) => v.id === pedida) ??
    views.find((v) => v.is_default) ??
    views[0] ??
    null
  );
}
