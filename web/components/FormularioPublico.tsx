"use client";
// Um formulário publicado, carregado pelo `slug` e desenhado.

import CarregaFormularioPublico from "@/components/CarregaFormularioPublico";
import FormularioSolicitacao from "@/components/FormularioSolicitacao";

export default function FormularioPublico({ slug }: { slug: string }) {
  return (
    <CarregaFormularioPublico slug={slug}>
      {({ categorias, categoriaPorSlug, form }) => (
        <FormularioSolicitacao
          // `key` pelo id do formulário: sem remontar, o estado e o rascunho de
          // um formulário vazariam para outro quando o `slug` muda.
          key={form.id}
          categorias={categorias}
          categoriaPorSlug={categoriaPorSlug}
          formId={form.id}
          titulo={form.title}
          descricao={form.description}
          identificacao={{
            telefone: form.phone_label,
            area: form.department_label,
            polo: form.polo_label,
          }}
        />
      )}
    </CarregaFormularioPublico>
  );
}
