// Lê o OpenAPI da API e monta a lista da aba Referência (Spec 065): rotas por assunto,
// parâmetros e campos do corpo com o tipo em português.

import type { OpenApi, OpenApiOperation, OpenApiSchema } from "@/lib/api";
import { normalizarBusca } from "@/lib/filtrosQuadro";

export type Campo = {
  nome: string;
  tipo: string;
  obrigatorio: boolean;
  descricao?: string;
  /** Onde vai: no caminho, na query ou no corpo. */
  onde: "caminho" | "query" | "corpo";
};

export type Rota = {
  metodo: string;
  caminho: string;
  resumo: string;
  descricao?: string;
  campos: Campo[];
};

export type Assunto = { id: string; nome: string; rotas: Rota[] };

const NOME_DO_ASSUNTO: Record<string, string> = {
  tasks: "Tarefas",
  boards: "Quadros",
  projects: "Projetos",
  solicitacoes: "Solicitações",
  comments: "Comentários",
  collaboration: "Responsáveis e seguidores",
  links: "Links",
  me: "Minhas coisas",
  members: "Pessoas",
  workspaces: "Organização e times",
  dashboard: "Painel",
  bases: "Bases",
  notifications: "Notificações",
  auth: "Login",
  developer: "Desenvolvedor",
};

/** Ordem na tela: o que mais se usa primeiro; o resto por nome. */
const ORDEM = ["tasks", "boards", "projects", "solicitacoes", "comments", "collaboration", "links", "me"];
const METODOS = ["get", "post", "put", "patch", "delete"];

function resolver(s: OpenApiSchema | undefined, api: OpenApi): OpenApiSchema | undefined {
  if (!s?.$ref) return s;
  return api.components?.schemas?.[s.$ref.split("/").pop() ?? ""];
}

export function tipoDe(s: OpenApiSchema | undefined, api: OpenApi): string {
  if (!s) return "qualquer";
  if (s.$ref) {
    const alvo = resolver(s, api);
    return alvo?.enum ? tipoDe(alvo, api) : `objeto ${s.$ref.split("/").pop()}`;
  }
  if (s.anyOf) {
    const semNulo = s.anyOf.filter((x) => x.type !== "null");
    const tipo = semNulo.map((x) => tipoDe(x, api)).join(" ou ");
    return semNulo.length < s.anyOf.length ? `${tipo} (ou null)` : tipo;
  }
  if (s.enum) return "um destes: " + s.enum.join(", ");
  if (s.type === "array") return `lista de ${tipoDe(s.items, api)}`;
  if (s.format === "uuid") return "id";
  if (s.format === "date") return "data (AAAA-MM-DD)";
  if (s.format === "date-time") return "data e hora (ISO)";
  return (
    { string: "texto", integer: "número inteiro", number: "número", boolean: "verdadeiro/falso", object: "objeto" }[
      s.type ?? ""
    ] ?? s.type ?? "qualquer"
  );
}

function camposDe(op: OpenApiOperation, api: OpenApi): Campo[] {
  const campos: Campo[] = (op.parameters ?? [])
    .filter((p) => p.in === "path" || p.in === "query")
    .map((p) => ({
      nome: p.name,
      tipo: tipoDe(p.schema, api),
      obrigatorio: Boolean(p.required),
      descricao: p.description,
      onde: p.in === "path" ? "caminho" : "query",
    }));
  const corpo = resolver(op.requestBody?.content?.["application/json"]?.schema, api);
  for (const [nome, s] of Object.entries(corpo?.properties ?? {})) {
    campos.push({
      nome,
      tipo: tipoDe(s, api),
      obrigatorio: corpo?.required?.includes(nome) ?? false,
      descricao: s.description,
      onde: "corpo",
    });
  }
  return campos;
}

/** A primeira linha da docstring vira o resumo; o FastAPI põe o nome da função em `summary`. */
function resumoDe(op: OpenApiOperation): { resumo: string; descricao?: string } {
  const [primeira, ...resto] = (op.description ?? "").trim().split("\n");
  if (primeira) return { resumo: primeira.trim(), descricao: resto.join("\n").trim() || undefined };
  return { resumo: op.summary ?? "" };
}

export function rotasPorAssunto(api: OpenApi): Assunto[] {
  const porTag = new Map<string, Rota[]>();
  for (const [caminho, ops] of Object.entries(api.paths)) {
    for (const metodo of METODOS) {
      const op = ops[metodo];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "outros";
      if (tag === "health" || tag === "observability") continue;
      const lista = porTag.get(tag) ?? [];
      lista.push({ metodo: metodo.toUpperCase(), caminho, ...resumoDe(op), campos: camposDe(op, api) });
      porTag.set(tag, lista);
    }
  }
  const posicao = (t: string) => (ORDEM.includes(t) ? ORDEM.indexOf(t) : ORDEM.length);
  return [...porTag.entries()]
    .map(([id, rotas]) => ({ id, nome: NOME_DO_ASSUNTO[id] ?? id, rotas }))
    .sort((a, b) => posicao(a.id) - posicao(b.id) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Filtra pelo caminho e pelo resumo, sem caixa nem acento. Assunto sem rota some. */
export function filtrar(assuntos: Assunto[], termo: string): Assunto[] {
  const t = normalizarBusca(termo);
  if (!t) return assuntos;
  return assuntos
    .map((a) => ({
      ...a,
      rotas: a.rotas.filter((r) => normalizarBusca(`${r.metodo} ${r.caminho} ${r.resumo} ${a.nome}`).includes(t)),
    }))
    .filter((a) => a.rotas.length > 0);
}
