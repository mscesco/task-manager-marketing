// A regra da página de Projetos: buscar e agrupar por categoria.

import type { Project, ProjectLabel } from "@/lib/api";
import { normalizarBusca } from "@/lib/filtrosQuadro";
import { semMarcacao } from "@/lib/markdown";

/** O projeto casa se o termo aparece no título, na descrição, na categoria ou numa tag.
 *  Sem acento e sem caixa: "evento" acha "Eventos". */
export function casaBusca(p: Project, termo: string): boolean {
  const alvo = normalizarBusca(termo);
  if (!alvo) return true;
  return [
    p.title,
    semMarcacao(p.description ?? ""),
    p.category?.name ?? "",
    ...p.tags.map((t) => t.name),
  ].some((texto) => normalizarBusca(texto).includes(alvo));
}

export type GrupoDeProjetos = { categoria: ProjectLabel | null; projetos: Project[] };

/** Uma seção por categoria, em ordem alfabética, e "Sem categoria" por último.
 *  Dentro da seção, a ordem que veio do servidor. Categoria sem projeto não aparece. */
export function agruparPorCategoria(projetos: readonly Project[]): GrupoDeProjetos[] {
  const porId = new Map<string, GrupoDeProjetos>();
  const sem: Project[] = [];
  for (const p of projetos) {
    if (!p.category) {
      sem.push(p);
      continue;
    }
    const g = porId.get(p.category.id) ?? { categoria: p.category, projetos: [] };
    g.projetos.push(p);
    porId.set(p.category.id, g);
  }
  const grupos = [...porId.values()].sort((a, b) =>
    a.categoria!.name.localeCompare(b.categoria!.name, "pt-BR", { sensitivity: "base" }),
  );
  return sem.length ? [...grupos, { categoria: null, projetos: sem }] : grupos;
}
