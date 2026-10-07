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

import FormularioPublico from "@/components/FormularioPublico";
import { MolduraPublica } from "@/components/MolduraPublica";

export default function SolicitarPorSlugPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? "");

  return (
    <MolduraPublica>
      <FormularioPublico slug={slug} />
    </MolduraPublica>
  );
}
