// Traduz o formulário que vem da API para a forma que a tela já sabe desenhar.
//
// ⚠️⚠️ ESTE ARQUIVO EXISTE PARA NÃO REESCREVER 922 LINHAS. O `/solicitar`
// consome `Categoria[]` (com `Campo[]`, `mostrarSe`, `resumoDe`, `prazo`) desde
// que existe, e essa forma está certa — o que mudou foi de ONDE ela vem. Um
// adaptador de 40 linhas troca a fonte sem tocar no fluxo de identificação,
// seleção, seções, revisão e envio.
//
// A alternativa era reescrever a página inteira contra o formato da API. Seria
// trocar duas coisas de uma vez na única porta pública do produto — e a fatia
// B já é a de maior risco da Spec 043 sem isso.
//
// ⚠️ E A TRADUÇÃO É DIRETA porque o banco foi desenhado a partir desta forma
// (Spec 043, §1): seis tipos, condicional por par (pergunta, valor), SLA em
// texto, e "qual resposta vira o resumo". Não há campo do TypeScript sem
// coluna correspondente, nem o contrário.

import type { Campo, CampoTipo, Categoria } from "@/lib/solicitacaoForm";
import type { FormularioPublico, PerguntaPublica } from "@/lib/api";

/**
 * ⚠️ Os seis tipos são os MESMOS nos dois lados, e o backend já recusa
 * qualquer outro na escrita (`QuestionKind`). Este `Set` não é validação
 * duplicada: é a garantia de que um tipo que escape por um caminho novo não
 * vire um campo que a tela não sabe desenhar — ela pula a pergunta em vez de
 * quebrar o formulário inteiro.
 */
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
    // ⚠️ `undefined` e não `[]` quando não há opções: a tela testa
    // `campo.opcoes` para decidir se desenha select ou input, e uma lista
    // vazia é verdadeira em JavaScript — desenharia um select sem alternativa.
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
 * ⚠️ SEÇÃO SEM PERGUNTA NENHUMA É DESCARTADA. Ela apareceria no menu como um
 * tipo de solicitação escolhível que, ao ser aberto, não pergunta nada — e a
 * pessoa ficaria olhando uma tela vazia sem saber se carregou errado.
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
        // ⚠️ RESERVA NO PRIMEIRO CAMPO quando não há resumo definido. O
        // `summary` vai para a fila de triagem, e sem ele o card lá mostra o
        // assunto e mais nada — quem tria precisaria abrir cada solicitação
        // para saber do que se trata. O primeiro campo é um palpite ruim, e
        // ainda assim melhor que vazio.
        resumoDe: s.summary_question_id ?? campos[0]?.id ?? "",
      };
    })
    .filter((c) => c.campos.length > 0);
}

/** O mapa por slug, como o `CATEGORIA_POR_SLUG` do arquivo estático. */
export function porSlug(categorias: Categoria[]): Record<string, Categoria> {
  return Object.fromEntries(categorias.map((c) => [c.slug, c]));
}
