"use client";
// /solicitar/<slug>: um formulário publicado, direto; é a URL de divulgação.
// Responde mesmo com um formulário só no workspace: o link divulgado não pode
// depender de quantos formulários existem.

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
