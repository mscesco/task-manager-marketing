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
/**
 * Busca um formulário publicado e entrega as categorias a quem desenha.
 *
 * ⚠️⚠️ OS DOIS ERROS SÃO DIFERENTES, E ESSA DISTINÇÃO É O ASSUNTO DESTE
 * ARQUIVO. A Camila pediu "falhar visível" e escreveu um texto; ao aplicá-lo,
 * apareceu que ele descreve UM dos dois estados:
 *
 *   - **404** -- o formulário não existe, foi despublicado, apagado, ou o
 *     endereço está errado. O remédio é com quem mandou o link.
 *   - **qualquer outra falha** -- rede, servidor fora, 500. O link está CERTO,
 *     e mandar a pessoa conferir com quem enviou seria fazê-la incomodar
 *     alguém por um problema nosso.
 *
 * Um texto só para os dois casos seria mentir em metade das vezes.
 *
 * ⚠️ E NÃO HÁ RESERVA NO `solicitacaoForm.ts`. Cair no arquivo estático
 * manteria a porta de pé, e serviria a versão VELHA das perguntas sem ninguém
 * perceber -- divergência silenciosa, que é o defeito que mais dói neste
 * projeto. Decisão da Camila, 24/08.
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
        // ⚠️ 404 É O ÚNICO QUE ACUSA O ENDEREÇO. O backend responde 404 para
        // quatro situações diferentes de propósito (não existe, despublicado,
        // apagado, de outro workspace) -- para quem está do lado de fora as
        // quatro significam a mesma coisa: este link não serve.
        setErro((e as ApiError).status === 404 ? "nao-existe" : "indisponivel");
      });
    return () => {
      vivo = false;
    };
  }, [slug]);

  if (erro === "nao-existe") {
    return (
      <Aviso
        titulo="Este formulário não está disponível"
        // O texto é o da Camila, ajustado ao tom do produto: ele fala em
        // imperativo com "você" e não usa "lhe" nem "te" em lugar nenhum.
        texto="Ele não existe mais, ou o endereço está errado. Peça o link a quem enviou e confira se está completo."
      />
    );
  }
  if (erro === "indisponivel") {
    return (
      <Aviso
        titulo="Não consegui carregar o formulário"
        // ⚠️ AQUI NÃO SE PEDE PARA CONFERIR O LINK: ele está certo, e o
        // problema é nosso.
        texto="Tente de novo em instantes. Se continuar assim, avise a equipe de marketing."
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
    // ⚠️ PUBLICADO E VAZIO NÃO É ERRO DE CARREGAMENTO -- é um formulário que
    // ficou sem perguntas. Cair no texto de "endereço errado" mandaria a
    // pessoa cobrar quem enviou por algo que quem MONTOU precisa resolver.
    return (
      <Aviso
        titulo="Este formulário ainda não tem perguntas"
        texto="Avise a equipe responsável — ele foi publicado sem conteúdo."
      />
    );
  }

  return <>{children({ categorias, categoriaPorSlug: porSlug(categorias), form })}</>;
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div
      role="alert"
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: 20,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <strong style={{ fontSize: 16, display: "block", marginBottom: 6 }}>
        {titulo}
      </strong>
      <p className="muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
        {texto}
      </p>
    </div>
  );
}
