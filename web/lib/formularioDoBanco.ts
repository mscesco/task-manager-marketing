// Traduz o formulário que vem da API para a forma `Categoria[]` que o
// `/solicitar` já desenha. A tradução é direta: o banco foi desenhado a
// partir desta forma.

import type { Campo, CampoTipo, Categoria } from "@/lib/solicitacaoForm";
import type { FormularioPublico, PerguntaPublica } from "@/lib/api";

/** Tipo desconhecido pula a pergunta em vez de quebrar o formulário. */
const TIPOS_CONHECIDOS: ReadonlySet<string> = new Set<CampoTipo>([
  "texto",
  "textoLongo",
  "escolha",
  "multi",
  "data",
  "link",
]);

function paraCampo(q: PerguntaPublica): Campo | null {
  if (!TIPOS_CONHECIDOS.has(q.kind)) return null;
  return {
    id: q.id,
    label: q.label,
    tipo: q.kind as CampoTipo,
    obrigatorio: q.required,
    // `undefined` e não `[]`: a tela testa `campo.opcoes` para escolher entre
    // select e input, e `[]` é verdadeiro.
    opcoes: q.options.length > 0 ? q.options : undefined,
    placeholder: q.placeholder ?? undefined,
    ajuda: q.help ?? undefined,
    mostrarSe:
      q.show_if_question_id && q.show_if_value !== null
        ? { campo: q.show_if_question_id, igual: q.show_if_value }
        : undefined,
  };
}

/**
 * As seções do formulário, na forma que a página consome.
 *
 * Seção sem pergunta nenhuma é descartada.
 */
export function paraCategorias(form: FormularioPublico): Categoria[] {
  return form.sections
    .map((s) => {
      const campos = s.questions
        .map(paraCampo)
        .filter((c): c is Campo => c !== null);
      return {
        slug: s.slug,
        titulo: s.title,
        emoji: s.emoji,
        prazo: s.sla_text,
        campos,
        // Sem resumo definido, o primeiro campo vira o resumo da triagem.
        resumoDe: s.summary_question_id ?? campos[0]?.id ?? "",
        repetivel: s.repeatable ?? false,
        rotuloRepeticao: s.repeat_label ?? null,
      };
    })
    .filter((c) => c.campos.length > 0);
}

/** O mapa por slug, como o que o arquivo estático montava. */
export function porSlug(categorias: Categoria[]): Record<string, Categoria> {
  return Object.fromEntries(categorias.map((c) => [c.slug, c]));
}
