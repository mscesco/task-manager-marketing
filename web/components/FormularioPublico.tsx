"use client";
// components/FormularioPublico.tsx
// Um formulario publicado, carregado pelo `slug` e desenhado. Era o mesmo
// bloco em `/solicitar` (quando so ha um formulario) e em `/solicitar/<slug>`
// -- inclusive o comentario do `key`, copiado (revisao de 07/10).

import CarregaFormularioPublico from "@/components/CarregaFormularioPublico";
import FormularioSolicitacao from "@/components/FormularioSolicitacao";

export default function FormularioPublico({ slug }: { slug: string }) {
  return (
    <CarregaFormularioPublico slug={slug}>
      {({ categorias, categoriaPorSlug, form }) => (
        <FormularioSolicitacao
          // ⚠️⚠️ `key` PELO ID DO FORMULARIO, e nao enfeite. O
          // `CarregaFormularioPublico` entrega o formulario por render prop: se
          // o `slug` mudar, este componente fica na MESMA posicao da arvore e o
          // React so troca as props -- sem remontar. O efeito que le o rascunho
          // roda so na montagem, entao o estado do formulario A sobreviveria, e
          // o efeito de GRAVACAO passaria a escreve-lo sob a chave de B: o
          // vazamento entre formularios que a chave por `formId` fechou.
          //
          // ⚠️ `key` E MELHOR QUE `formId` NAS DEPENDENCIAS: remontar zera TODO
          // o estado (ident, selecionadas, valores, passo), e nao so o que
          // alguem lembrar de listar.
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
