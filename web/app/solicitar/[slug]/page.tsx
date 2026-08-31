"use client";
// /solicitar/<slug> -- um formulario publicado, direto (Spec 043, fatia B).
//
// ⚠️ ESTA E A URL DE DIVULGACAO. A decisao da Camila foi "os dois": a lista em
// `/solicitar` para quem nao sabe qual usar, e um endereco proprio por
// formulario para quem manda o link.
//
// ⚠️ E ELA RESPONDE MESMO COM UM FORMULARIO SO no workspace. O `/solicitar`
// abre direto nesse caso, mas o link divulgado nao pode depender de quantos
// formularios existem hoje -- publicar o segundo nao pode quebrar o cartaz
// impresso do primeiro.

import { useParams } from "next/navigation";

import CarregaFormularioPublico from "@/components/CarregaFormularioPublico";
import FormularioSolicitacao from "@/components/FormularioSolicitacao";

export default function SolicitarPorSlugPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? "");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <CarregaFormularioPublico slug={slug}>
          {({ categorias, categoriaPorSlug, form }) => (
            <FormularioSolicitacao
              // ⚠️⚠️ `key` PELO ID DO FORMULARIO, e nao enfeite. O
              // `CarregaFormularioPublico` entrega o formulario por render
              // prop: se o `slug` mudar, este componente fica na MESMA posicao
              // da arvore e o React so troca as props -- sem remontar. O
              // efeito que le o rascunho roda so na montagem, entao o estado
              // do formulario A sobreviveria, e o efeito de GRAVACAO passaria
              // a escreve-lo sob a chave de B: o vazamento entre formularios
              // que a chave por `formId` acabou de fechar, voltando por outra
              // porta.
              //
              // ⚠️ `key` E MELHOR QUE POR `formId` NAS DEPENDENCIAS: remontar
              // zera TODO o estado (ident, selecionadas, valores, passo), e
              // nao so o que alguem lembrar de listar.
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
      </div>
    </div>
  );
}
