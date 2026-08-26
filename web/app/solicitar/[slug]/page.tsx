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
          {({ categorias, categoriaPorSlug }) => (
            <FormularioSolicitacao
              categorias={categorias}
              categoriaPorSlug={categoriaPorSlug}
            />
          )}
        </CarregaFormularioPublico>
      </div>
    </div>
  );
}
