"use client";
import { useEffect, useState } from "react";

import {
  ApiError,
  obterFormularioPublico,
  type FormularioPublico,
} from "@/lib/api";
import { paraCategorias, porSlug } from "@/lib/formularioDoBanco";
import type { Categoria } from "@/lib/solicitacaoForm";

import Loading from "@/components/Loading";
import { AvisoPublico } from "@/components/MolduraPublica";
/**
 * Busca um formulário publicado e entrega as categorias a quem desenha.
 *
 * 404 (link que não serve) e as demais falhas (problema nosso, o link está
 * certo) têm textos diferentes. Não há reserva estática: serviria perguntas
 * desatualizadas sem ninguém perceber.
 */
export default function CarregaFormularioPublico({
  slug,
  children,
}: {
  slug: string;
  children: (dados: {
    categorias: Categoria[];
    categoriaPorSlug: Record<string, Categoria>;
    form: FormularioPublico;
  }) => React.ReactNode;
}) {
  const [form, setForm] = useState<FormularioPublico | null>(null);
  const [erro, setErro] = useState<"nao-existe" | "indisponivel" | null>(null);

  useEffect(() => {
    let vivo = true;
    setForm(null);
    setErro(null);
    obterFormularioPublico(slug)
      .then((f) => {
        if (vivo) setForm(f);
      })
      .catch((e) => {
        if (!vivo) return;
        // O backend responde 404 para não existe, despublicado, apagado e de
        // outro workspace: para quem está fora, tudo é "este link não serve".
        setErro((e as ApiError).status === 404 ? "nao-existe" : "indisponivel");
      });
    return () => {
      vivo = false;
    };
  }, [slug]);

  if (erro === "nao-existe") {
    return (
      <AvisoPublico estreito
        titulo="Este formulário não está disponível"
        texto="Ele não existe mais, ou o endereço está errado. Peça o link a quem enviou e confira se está completo."
      />
    );
  }
  if (erro === "indisponivel") {
    return (
      <AvisoPublico estreito
        titulo="Não consegui carregar o formulário"
        // Aqui não se pede para conferir o link: ele está certo.
        texto="Tente de novo em instantes. Se continuar assim, avise quem enviou este link."
      />
    );
  }
  if (!form) {
    return (
      <Loading rotulo="Carregando o formulário" />
    );
  }

  const categorias = paraCategorias(form);
  if (categorias.length === 0) {
    // Publicado e vazio não é erro de carregamento: quem resolve é quem montou.
    return (
      <AvisoPublico estreito
        titulo="Este formulário ainda não tem perguntas"
        texto="Avise a equipe responsável — ele foi publicado sem conteúdo."
      />
    );
  }

  return <>{children({ categorias, categoriaPorSlug: porSlug(categorias), form })}</>;
}

